/**
 * paths — vault-relative path safety helpers (the path-safety port).
 *
 * Single source of truth for the validation pipeline that every
 * vault-mutating action runs before touching the filesystem:
 *   schema → normalize → contain → denyList → payloadGuard → execute
 * (PRD F9). Callers: InstructionExecutor (vault writes), action
 * handlers, FsHookLoader (hooks dir resolution). Each helper is pure
 * and synchronous so the executor can pre-flight without I/O.
 *
 * Review L15 — file-level "why" header per Constitution L2.
 */

import { normalizePath } from "obsidian";

export type SafetyResult =
	| { ok: true; vaultRelativePath: string }
	| { ok: false; reason: string };

/**
 * Characters that must not appear inside a single filename segment. `\` and
 * `:` are illegal on the platforms Hashi targets (macOS primary, Linux); `/`
 * is the path separator (legal in a full path, illegal inside one segment);
 * `* ? " < > |` round out the cross-platform reserved set Obsidian guards in
 * its own `checkPath`; NUL (`\x00`) can never appear in a filesystem name.
 *
 * This mirrors Tomo's authoritative producer-side set
 * (`tomo/scripts/lib/obsidian_filename.py`) so producer and executor agree on
 * exactly what "Obsidian-safe" means (filename-sanitization contract,
 * Tomo 2026-06-17). Kept here so `paths.ts` stays the single source of truth
 * for path safety.
 */
const ILLEGAL_FILENAME_CHARS: readonly string[] = [
	"\\",
	"/",
	":",
	"*",
	"?",
	'"',
	"<",
	">",
	"|",
	"\x00",
];

/**
 * Inspect the basename of a vault-relative path for characters Obsidian
 * rejects in a filename. The directory portion is ignored — `/` is only an
 * offence inside the final segment, never as a separator.
 *
 * Returns the offending characters in first-seen order, de-duplicated; an
 * empty array means the filename is clean. Pure and synchronous so action
 * handlers can pre-flight a rename without I/O and turn a would-be Obsidian
 * throw into a reportable `failed` outcome.
 */
export function findIllegalFilenameChars(path: string): string[] {
	const slash = path.lastIndexOf("/");
	const basename = slash === -1 ? path : path.slice(slash + 1);

	const found: string[] = [];
	for (const ch of ILLEGAL_FILENAME_CHARS) {
		if (basename.includes(ch) && !found.includes(ch)) {
			found.push(ch);
		}
	}
	return found;
}

/**
 * Render a list of illegal characters for an error message: each quoted, joined
 * by `, `. Non-printable chars (e.g. NUL) are shown as their `\xNN` escape so
 * the message stays legible in logs instead of embedding a raw control byte.
 */
export function formatIllegalChars(chars: readonly string[]): string {
	return chars
		.map((c) => {
			const code = c.charCodeAt(0);
			if (code < 0x20 || code === 0x7f) {
				return `'\\x${code.toString(16).padStart(2, "0")}'`;
			}
			return `'${c}'`;
		})
		.join(", ");
}

/**
 * Documented validation order for any vault-targeting action. Callers
 * (Phase 4 InstructionExecutor) MUST evaluate in this order and short-circuit
 * on the first failure. Mirrors PRD F9 verbatim: schema → normalize → contain
 * → denyList → payloadGuard → execute.
 */
export const VALIDATION_ORDER: readonly [
	"schema",
	"normalize",
	"contain",
	"denyList",
	"payloadGuard",
	"execute",
] = ["schema", "normalize", "contain", "denyList", "payloadGuard", "execute"] as const;

// Fixed deny-list patterns for v0.1 (not user-configurable beyond hooksDir).
const FIXED_DENY_PATTERNS: readonly RegExp[] = [
	/^\.obsidian(\/|$)/,
	/^\.git(\/|$)/,
	/^\.trash(\/|$)/,
];

/**
 * Normalize and contain a raw path string. Vault-root containment is checked
 * structurally (no fs ops). Symlink containment is a separate async function
 * (`verifyRealpathContainment`) — call it before any vault write.
 *
 * Rejects: absolute paths (POSIX `/foo`, backslash `\foo`), Windows drive
 * letters (`C:`, `D:foo`), `..`-traversal segments, double-separator empty
 * segments. All rejections carry `reason: "Path escapes vault root"`.
 *
 * Accepts: vault-relative paths after normalization (`a/b/c.md`, `Atlas/foo`).
 * Empty string is accepted as a sentinel for "not configured".
 */
export function normalizeAndContain(rawPath: string): SafetyResult {
	// Empty string is the sentinel for unconfigured — pass through.
	if (rawPath === "") {
		return { ok: true, vaultRelativePath: "" };
	}

	// Reject Windows drive letters before normalization (e.g. C:\foo, D:foo).
	if (/^[A-Za-z]:/.test(rawPath)) {
		return { ok: false, reason: "Path escapes vault root" };
	}

	// Reject empty segments before normalization (normalizePath collapses //
	// which would hide this violation). Check the raw path after backslash
	// conversion to catch both / and \ variants.
	const rawForwardSlash = rawPath.replace(/\\/g, "/");
	if (/\/\//.test(rawForwardSlash)) {
		return { ok: false, reason: "Path escapes vault root" };
	}

	// Apply Obsidian normalizePath: collapses \\ → /, repeated // → /.
	const normalized = normalizePath(rawPath);

	// Reject POSIX absolute paths (start with /).
	if (normalized.startsWith("/")) {
		return { ok: false, reason: "Path escapes vault root" };
	}

	const segments = normalized.split("/");

	for (const segment of segments) {
		// Reject traversal segments.
		if (segment === "..") {
			return { ok: false, reason: "Path escapes vault root" };
		}
		// Reject empty segments (occurs from leading / which was already caught,
		// or trailing /, or // which normalizePath should collapse but guard anyway).
		if (segment === "" && normalized !== "") {
			return { ok: false, reason: "Path escapes vault root" };
		}
	}

	return { ok: true, vaultRelativePath: normalized };
}

/**
 * Tests if a vault-relative path falls under any deny pattern. The first
 * three patterns are fixed for v0.1; the fourth is the runtime-injected
 * `hooksDir`.
 *
 * Returns true on match (denied). Comparison is prefix-based with separator
 * boundary — `.obsidian` matches but `my.obsidiania/foo` does NOT.
 */
export function denyListMatch(
	vaultRelativePath: string,
	hooksDir: string,
): boolean {
	for (const pattern of FIXED_DENY_PATTERNS) {
		if (pattern.test(vaultRelativePath)) return true;
	}

	// Inject runtime hooksDir as a prefix pattern (with separator boundary).
	// Strip leading `./` and trailing `/` so user settings like ".tomo-hashi/hooks/"
	// or "./.tomo-hashi/hooks" still match correctly — otherwise the regex would
	// silently fail to deny writes into the hooksDir.
	const normalizedHooksDir = hooksDir.replace(/^\.\//, "").replace(/\/+$/, "");
	if (normalizedHooksDir !== "") {
		const escaped = normalizedHooksDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const hooksDirPattern = new RegExp(`^${escaped}(\\/|$)`);
		if (hooksDirPattern.test(vaultRelativePath)) return true;
	}

	return false;
}

/**
 * Async symlink-containment check. Resolves the on-disk realpath of the
 * vault-relative path against the vault root and rejects when the realpath
 * is not a descendant of the root.
 *
 * `realpath` is injectable for testing — production callers pass nothing
 * and the function uses node's `fs/promises.realpath`.
 *
 * Returns:
 * - `{ ok: true; vaultRelativePath }` when the realpath is under vault root,
 *   OR when the path doesn't yet exist (ENOENT — a not-yet-created file
 *   cannot be a symlink-escape).
 * - `{ ok: false; reason: "path-symlink-escape" }` when the realpath escapes
 *   the vault root.
 *
 * Other I/O errors (EPERM, ELOOP, etc.) bubble — those are real failures
 * that callers should surface as errors, not silently mask as "safe".
 */
export async function verifyRealpathContainment(
	vaultRoot: string,
	vaultRelativePath: string,
	realpath?: (p: string) => Promise<string>,
): Promise<SafetyResult> {
	const resolveRealpath =
		realpath ??
		(async (p: string) => {
			const { realpath: fsRealpath } = await import("node:fs/promises");
			return fsRealpath(p);
		});

	// Normalize root to never have a trailing slash — makes the join below
	// produce a single separator, and the prefix check unambiguous.
	const root = vaultRoot.replace(/\/+$/, "");
	const fullPath = `${root}/${vaultRelativePath}`;

	let resolved: string;
	try {
		resolved = await resolveRealpath(fullPath);
	} catch (err) {
		// A not-yet-existing path cannot be a symlink-escape — this is the
		// "create new file" path in Phase 4 and must be safe by construction.
		const code = (err as { code?: string } | null)?.code;
		if (code === "ENOENT") {
			return { ok: true, vaultRelativePath };
		}
		throw err;
	}

	// Prefix check uses `root + "/"` to guarantee separator boundary —
	// `/vault-evil/foo` must NOT pass when root is `/vault`.
	const rootWithSep = `${root}/`;
	if (!resolved.startsWith(rootWithSep) && resolved !== root) {
		return { ok: false, reason: "path-symlink-escape" };
	}

	return { ok: true, vaultRelativePath };
}
