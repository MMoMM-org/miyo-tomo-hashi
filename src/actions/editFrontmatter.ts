/**
 * editFrontmatter handler — set or remove a YAML property on a note.
 *
 * The only action that edits frontmatter. It exists because nothing else could:
 * `edit_note_text` freezes the block by contract, so a link living in `up:` (or
 * any other key) was unrepairable — and worse, used to report success while
 * leaving the note wrong. See that handler's frontmatter guard.
 *
 * Structural, never textual. All work happens through
 * `VaultFS.processFrontMatter`, which hands over the PARSED object. Literal
 * string surgery on YAML is how documents get corrupted, and is precisely what
 * this kind exists to avoid.
 *
 * Optimistic locking: `expected` is compared deep-equal against the value found
 * at the moment of writing. A mismatch fails and writes NOTHING — a vault that
 * changed between report and apply is never silently clobbered. The repair path
 * is the Instruction Fixer, which can edit `expected` and `value`.
 *
 * The comparison happens INSIDE the processFrontMatter callback, not before it.
 * That is the only state guaranteed fresh: `metadataCache` is subject to the
 * async-rebuild race that bit multi-action batches in #68, and a stale read here
 * would defeat the entire point of the guard.
 *
 * Outcomes:
 *   expectation met, value differs   → applied
 *   expectation met, already correct → skipped-already   (idempotent re-run)
 *   expectation NOT met              → failed, nothing written
 *   not a .md file                   → failed  (processFrontMatter is md-only)
 *   note missing / malformed YAML    → failed
 *
 * [ref: PRD/F4; SDD/Obsidian API Mapping per Action Kind]
 */

import type { EditFrontmatterAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import { isMarkdown } from "../util/paths.js";
import type { HandlerContext } from "./types.js";

type EditOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

/**
 * Own-property probe. `Object.hasOwn` is ES2022 and this project's tsconfig
 * `lib` stops at ES7, so use the prototype call — and it must be a probe rather
 * than an `in` check or a truthiness test, because `up: null` and `up: false`
 * are values a note may legitimately carry.
 */
function hasKey(obj: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Structural deep equality over parsed YAML/JSON values. Arrays compare
 * element-wise and order-sensitively — `up: [A, B]` is not `up: [B, A]`, and
 * pretending otherwise would let the guard pass on a note someone reordered.
 * Objects compare by key set and value, key order ignored (YAML mappings are
 * unordered).
 */
function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((item, i) => deepEqual(item, b[i]));
	}
	if (typeof a !== "object" || typeof b !== "object") return false;
	const ao = a as Record<string, unknown>;
	const bo = b as Record<string, unknown>;
	const aKeys = Object.keys(ao);
	const bKeys = Object.keys(bo);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every((k) => hasKey(bo, k) && deepEqual(ao[k], bo[k]));
}

/** Render a value for a failure message without dumping note content wholesale. */
function describeValue(value: unknown, present: boolean): string {
	if (!present) return "absent";
	if (value === null) return "null";
	if (Array.isArray(value)) return `list of ${String(value.length)}`;
	if (typeof value === "object") return "map";
	return typeof value;
}

export async function editFrontmatter(
	action: EditFrontmatterAction,
	ctx: HandlerContext,
): Promise<EditOutcome> {
	const { vault } = ctx;
	const { path, property, operation, expected } = action;

	// Obsidian documents processFrontMatter as "Must be a Markdown file". A
	// .canvas or .base target would throw mid-run; reject it up front instead,
	// same reject-never-repair stance as the move kinds.
	if (!isMarkdown(path)) {
		return {
			kind: "failed",
			reason: `edit_frontmatter only handles markdown notes, got: ${path}`,
		};
	}

	if (!(await vault.exists(path))) {
		return { kind: "failed", reason: "target note missing" };
	}

	// `expected: null` means "must not exist" — see the type docblock.
	const expectAbsent = expected === null;

	let outcome: EditOutcome = { kind: "applied" };

	try {
		await vault.processFrontMatter(path, (fm) => {
			const present = hasKey(fm, property);
			const current = present ? fm[property] : undefined;

			const matches = expectAbsent ? !present : present && deepEqual(current, expected);
			if (!matches) {
				// Mutate nothing. The note must come out byte-identical: a guard
				// that rewrites the file while refusing to apply is worse than no
				// guard at all.
				outcome = {
					kind: "failed",
					reason:
						`frontmatter '${property}' in ${path} is not what the instruction expected ` +
						`(expected ${describeValue(expected, !expectAbsent)}, found ${describeValue(current, present)}) ` +
						`— the note changed since the instruction set was written; repair 'expected' in the editor or re-run the audit`,
				};
				return;
			}

			if (operation === "remove") {
				if (!present) {
					outcome = { kind: "skipped-already" };
					return;
				}
				delete fm[property];
				return;
			}

			if (present && deepEqual(current, action.value)) {
				outcome = { kind: "skipped-already" };
				return;
			}
			fm[property] = action.value;
		});
	} catch (err) {
		// Obsidian raises YAMLParseError on a malformed block. Fail this one
		// action with the reason rather than letting it abort the run.
		const message = err instanceof Error ? err.message : String(err);
		return { kind: "failed", reason: `frontmatter could not be parsed in ${path}: ${message}` };
	}

	return outcome;
}
