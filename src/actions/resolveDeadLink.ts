/**
 * resolveDeadLink handler — alias-aware dead-wikilink fix inside a note's BODY.
 *
 * Supersedes the earlier `edit_note_text` construction for dead_link fixes,
 * which matched the whole `[[…]]` text literally and therefore silently
 * no-opped whenever the dead link carried a display alias Tomo never saw —
 * Tomo only knows the bare dead target, never the note body or its alias
 * text, which is exactly why this resolution is delegated to Hashi.
 * Introduced by Tomo commit 4251618.
 *
 * Contract (Tomo $def `resolve_dead_link`):
 *   - Locates every occurrence of `target` in ALL wikilink forms in the
 *     note BODY only (YAML frontmatter is frozen verbatim, mirroring
 *     editNoteText's frontmatter split):
 *       bare  `[[target]]`
 *       alias `[[target|display]]`
 *       embed `![[target]]`
 *   - `replace === ""` → UNLINK: drop the `[[ ]]`, keeping the DISPLAY text
 *     when there was an alias (`[[t|Nice]]` → `Nice`), else the bare
 *     target text (`[[t]]` → `t`, `![[t]]` → `t` — an embed unlink mirrors
 *     a bare unlink; the `!` and brackets are dropped, the target survives
 *     as plain text).
 *   - `replace === "[[New]]"` → REPOINT to New, preserving any display
 *     (`[[t|Nice]]` → `[[New|Nice]]`, `[[t]]` → `[[New]]`). `replace` is
 *     also accepted defensively as a bare stem without brackets.
 *   - Replaces EVERY occurrence in the body.
 *   - No match ANYWHERE → skip-and-report (`skipped-already`), no partial
 *     write — mirrors editNoteText / removeUpLink's "not-found is a no-op
 *     success" convention. Idempotent: re-running after a resolution finds
 *     no further match and skips again.
 *   - Match found ONLY in the frozen frontmatter → `failed`. A body-only
 *     action can never reach it, in this run or any future one, so reporting
 *     a no-op success would graduate the action to `applied: true` and hide a
 *     permanently unrepaired note. Same treatment as editNoteText — see the
 *     guard in the handler body.
 *   - Missing note → `failed`.
 *
 * Matching: the target is regex-escaped (it may contain `(`, `)`, `/`,
 * spaces, etc.) and the match is anchored directly against the `[[`/`|`/`]]`
 * delimiters, so the target must fill the ENTIRE link-target slot — a
 * `[[Old MOC]]` link is never matched by target `MOC` (a naive substring
 * match would wrongly hit it).
 *
 * [ref: Tomo commit 4251618; src/schema/instructions.schema.json
 * $defs.resolve_dead_link; src/actions/editNoteText.ts frontmatter-freeze +
 * skipped-already convention]
 */

import type { ResolveDeadLinkAction } from "../schema/types.js";
import type { ActionOutcome } from "../executor/state.js";
import type { HandlerContext } from "./types.js";

type ResolveOutcome = Extract<ActionOutcome, { kind: "applied" | "skipped-already" | "failed" }>;

/** Escape a literal string for safe embedding inside a RegExp source. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split a note into its frozen frontmatter head (including the closing `---`
 * fence and its trailing newline) and the editable body. When there is no
 * well-formed leading frontmatter block, the whole content is body. Mirrors
 * editNoteText.ts's splitFrontmatter — kept local rather than shared, since
 * duplicating this five-line pure function is cheaper than introducing a
 * cross-handler dependency for it.
 */
function splitFrontmatter(content: string): { head: string; body: string } {
	if (!content.startsWith("---\n")) return { head: "", body: content };
	const close = content.indexOf("\n---", 4);
	if (close === -1) return { head: "", body: content };
	const afterFence = content.indexOf("\n", close + 1);
	if (afterFence === -1) return { head: content, body: "" };
	return { head: content.slice(0, afterFence + 1), body: content.slice(afterFence + 1) };
}

/**
 * Extract the new target stem from a `[[New]]` / `[[New|Alias]]` replace
 * value. Falls back to the raw string when it carries no brackets — Tomo
 * always sends a bracketed wikilink for a repoint, but a bare stem is
 * handled defensively rather than silently mis-writing `[[[[New]]]]`.
 */
function extractNewTarget(replace: string): string {
	const m = /^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(replace);
	return m?.[1] ?? replace;
}

/**
 * Build a regex matching every wikilink occurrence of `target` — bare,
 * aliased, or embedded. The `!?` embed marker is matched but NOT captured
 * (it's dropped along with the brackets on replace). Group 1 is the optional
 * `|display` alias tail (undefined when absent); group 2 is the display text
 * itself.
 */
function buildLinkRegex(target: string): RegExp {
	const escaped = escapeRegExp(target);
	return new RegExp(`!?\\[\\[${escaped}(\\|([^\\]]*))?\\]\\]`, "g");
}

/**
 * Apply the unlink/repoint transform to the body only. Returns the
 * rewritten full content and whether anything changed. Pure — called both
 * pre-flight (idempotency gate) and inside `vault.process` (race-safe
 * fresh transform), mirroring editNoteText's applyEdit.
 */
function applyResolve(
	content: string,
	target: string,
	replace: string,
): { content: string; changed: boolean } {
	const { head, body } = splitFrontmatter(content);
	const re = buildLinkRegex(target);
	const newTarget = replace === "" ? null : extractNewTarget(replace);
	let changed = false;

	const newBody = body.replace(re, (_full: string, aliasTail: string | undefined, display: string | undefined) => {
		changed = true;
		const hasAlias = aliasTail !== undefined;
		if (newTarget === null) {
			// Unlink: keep the display text when aliased, else the bare target.
			return hasAlias ? (display ?? "") : target;
		}
		// Repoint: preserve any display.
		return hasAlias ? `[[${newTarget}|${display ?? ""}]]` : `[[${newTarget}]]`;
	});

	return { content: head + newBody, changed };
}

export async function resolveDeadLink(
	action: ResolveDeadLinkAction,
	ctx: HandlerContext,
): Promise<ResolveOutcome> {
	const { vault } = ctx;
	const { path, target, replace } = action;

	if (!(await vault.exists(path))) {
		return { kind: "failed", reason: "target note missing" };
	}

	const content = await vault.cachedRead(path);
	if (!applyResolve(content, target, replace).changed) {
		// No body hit. Two different situations hide behind that, and
		// conflating them is how a dead link marks itself done:
		//
		//   - genuinely absent  → the vault may have been fixed by hand
		//     between report and apply. `skipped-already` is right, and it
		//     graduates to `applied: true`.
		//   - present, but in the frozen frontmatter → this action CANNOT ever
		//     touch it. Reporting success would graduate it too, filtering the
		//     action out of every later run and leaving the dead link in place
		//     with nothing reported.
		//
		// The second is a structural blind spot, not a race. Reported by Tomo
		// 2026-09-01 after the same construction was fixed in editNoteText
		// (PR #122) — this is the kind garden-audit actually emits, so the bug
		// was live here while it was already dead code there.
		//
		// The head is probed with the SAME regex the body uses, not a literal
		// substring: `target` is a link stem, and the frontmatter carries it as
		// `"[[stem]]"`. A looser check would fire on the stem appearing as
		// ordinary text in some unrelated property.
		const { head } = splitFrontmatter(content);
		if (head !== "" && buildLinkRegex(target).test(head)) {
			return {
				kind: "failed",
				reason: `dead link found only in the YAML frontmatter, which resolve_dead_link never edits (it is a note-body action) — ${path}. Frontmatter properties need edit_frontmatter; resolve_dead_link cannot repair this and must not report it as done`,
			};
		}
		return { kind: "skipped-already" };
	}

	await vault.process(path, (current) => applyResolve(current, target, replace).content);
	return { kind: "applied" };
}
