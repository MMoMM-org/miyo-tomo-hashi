import { normalizePath } from "obsidian";

export type SafetyResult =
	| { ok: true; vaultRelativePath: string }
	| { ok: false; reason: string };

/**
 * Documented validation order for any vault-targeting action. Callers
 * (Phase 4 InstructionExecutor) MUST evaluate in this order and short-circuit
 * on the first failure.
 */
export const VALIDATION_ORDER: readonly [
	"schema",
	"normalize",
	"contain",
	"denyList",
	"execute",
] = ["schema", "normalize", "contain", "denyList", "execute"] as const;

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
	if (hooksDir !== "") {
		const escaped = hooksDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
 * Returns `{ ok: false; reason: "path-symlink-escape" }` on escape.
 * All other failures (e.g. ENOENT) bubble.
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

	const fullPath = `${vaultRoot}/${vaultRelativePath}`;
	const resolved = await resolveRealpath(fullPath);

	// Ensure vault root ends with / for reliable prefix check.
	const rootWithSep = vaultRoot.endsWith("/") ? vaultRoot : `${vaultRoot}/`;

	if (!resolved.startsWith(rootWithSep) && resolved !== vaultRoot) {
		return { ok: false, reason: "path-symlink-escape" };
	}

	return { ok: true, vaultRelativePath };
}
