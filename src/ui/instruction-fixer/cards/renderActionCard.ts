/**
 * `renderActionCard` — the Instruction Fixer's card BODY (spec-006 Phase 3,
 * T3.2; SDD ADR-5, PRD F2/F3/F4/F6).
 *
 * The seam: `InstructionFixerView` renders everything the OUTCOME says (group
 * sections, card shell, `I07 · link_to_moc` header, outcome badge,
 * frozen/read-only tag, failure reason); this module renders everything the
 * KIND says — the plain-text intent line, the repair-field controls, and the
 * note link. See `fixerContract.ts` for why the split sits exactly there.
 *
 * --- Decisions ---
 *
 * 1. The intent line is PLAIN TEXT, deliberately (PRD F2-AC4). The origin bug
 *    this whole spec answers was a run-log deep-link into the `.md` peer's
 *    heading that went malformed whenever the heading embedded `[[wikilinks]]`.
 *    An intent that embeds `[[…]]` therefore renders as literal characters in
 *    a text node here — never as markdown, never as a link. The ONE navigable
 *    element on a card is the note link at the bottom, which points at a real
 *    vault path rather than at a heading inside a document.
 *
 * 2. Read-only is enforced by rendering a DIFFERENT control, not by disabling
 *    one: on any gate but `editable` the field renders as a text span, so
 *    there is no input, no picker, and no path from this card into
 *    `setTargetField` at all. A disabled input would leave the write path one
 *    DOM-property flip away from live; this leaves nothing to flip.
 *
 * 3. Every commit goes through `setTargetField` unchanged, which returns the
 *    SAME model reference on a no-op (a re-commit of the value already on the
 *    wire). The store's `Object.is` check then makes that a true no-op: no
 *    re-render, no dirty flag, Save stays exactly as it was. Nothing here
 *    pre-filters for that — one definition of "did this change anything" lives
 *    in the transform, and the card must not grow a second, drifting copy.
 *
 * 4. Fields render for editable cards even when the whole card is read-only,
 *    because viewing is unrestricted and is a distinct capability from editing
 *    (ADR-027 Tightening ①) — a frozen card still shows what its target fields
 *    hold, just not a way to change them.
 */

import type { Action } from "../../../schema/types.js";
import { anchorSpotKindOf } from "../../../instruction-fixer/noteSpots.js";
import { setAnchorSpot, setMarkerSpot, setTargetField } from "../../../instruction-fixer/transforms.js";
import { renderNavigableNoteLink } from "../../garden-audit-view/noteNavigation.js";
import {
	renderTargetControlCore,
	type TargetControlCoreOptions,
} from "../../garden-audit-view/TargetControl.js";
import type { FixerCardContext, FixerCardRenderer } from "../fixerContract.js";
import {
	openAnchorSpotPicker,
	openMarkerSpotPicker,
} from "../pickers/openSpotPicker.js";

import { targetFieldsFor, type TargetField } from "./targetFields.js";

/** Longest embedded value an intent line quotes before eliding. */
const INTENT_VALUE_LIMIT = 80;

/** Quote a wire value into the intent line, elided so one card stays legible. */
function quote(value: string): string {
	const collapsed = value.replace(/\s+/g, " ").trim();
	if (collapsed === "") return '""';
	return collapsed.length <= INTENT_VALUE_LIMIT
		? `"${collapsed}"`
		: `"${collapsed.slice(0, INTENT_VALUE_LIMIT)}…"`;
}

/** An anchor's text, or a plain marker for Tomo's unresolved-at-emission null. */
function anchorText(value: string | null): string {
	return value === null ? "(unresolved)" : quote(value);
}

/**
 * One plain-language sentence naming what the action was approved to do.
 *
 * Exhaustive over `Action["action"]` (no `default`), so a new wire kind is a
 * compile error here rather than a card that silently renders no intent at
 * all. Unlike the run log's `buildSummary`, this may name note content: it is
 * rendered locally into the user's own editor and never persisted anywhere
 * (Constitution Privacy L2 governs audit traces, not on-screen text).
 *
 * Quoting rule: LITERAL text — a title, a line to write, a match/replace
 * string, an anchor's or marker's match text — is quoted, because whitespace
 * and emptiness are part of its meaning and only quotes make that visible.
 * Paths and bare stems are identifiers and stay unquoted.
 *
 * Every path the action names appears here, including ones the card offers no
 * field for. `create_moc` is the case that forced the rule: it is mechanically
 * a move (`source` → `destination`), it carries no repair field, its note link
 * points at the destination — and its most common failure, "Source missing —
 * nothing to move", interpolates no path at all. Without `source` in this
 * sentence the user could not tell which file went missing.
 *
 * The same rule covers the PAYLOAD — the text an action writes — for exactly
 * the same reason, and this is where the first version fell short: an intent
 * naming only the target answers "where does this go?" but not "what goes
 * there?", so `link_to_moc` read as "Link into @, after heading Maintenance"
 * with no way to tell WHICH note was being linked. The payload comes from the
 * field the executor actually writes (`line_to_add`, `content`), never from a
 * friendlier label alongside it: `source_note_title` is a derived hint Tomo may
 * emit as null, and a card that showed it while the executor wrote something
 * else would mislead the one user who most needs the truth — the one about to
 * repair the action.
 */
export function actionIntent(action: Action): string {
	switch (action.action) {
		case "create_moc":
			return `Create MOC ${quote(action.title)} at ${action.destination} (from ${action.source})`;
		case "move_note":
			return `Move ${action.source} → ${action.destination}`;
		case "link_to_moc":
			return `Link ${quote(action.line_to_add)} into ${action.target_moc}, ${action.placement} ${action.anchor.type} ${anchorText(action.anchor.value)}`;
		case "insert_under_marker":
			return `Insert ${quote(action.content)} into ${action.target_path}, ${action.placement} ${action.anchor.type} ${anchorText(action.anchor.value)}`;
		case "replace_section":
			return `Replace section ${anchorText(action.anchor.value)} in ${action.target_path} with ${quote(action.content)}`;
		case "add_relationship":
			return `Add ${quote(action.line)} under ${quote(action.marker)} in ${action.target_moc_path}`;
		case "edit_note_text":
			return action.replace === ""
				? `Delete ${quote(action.match)} in ${action.path} (${action.occurrence ?? "first"})`
				: `Replace ${quote(action.match)} with ${quote(action.replace)} in ${action.path} (${action.occurrence ?? "first"})`;
		case "remove_up_link":
			return `Remove the link to ${action.link} from up:: in ${action.path}`;
		case "resolve_dead_link":
			return action.replace === ""
				? `Unlink the dead link ${action.target} in ${action.path}`
				: `Repoint the dead link ${action.target} to ${action.replace} in ${action.path}`;
		case "update_tracker":
			return `Set ${action.field} to ${String(action.value)} in ${action.daily_note_path}`;
		case "update_log_entry":
			return `Log an entry under ${action.section} in ${action.daily_note_path}`;
		case "update_log_link":
			return `Log a link to ${action.target_stem} under ${action.section} in ${action.daily_note_path}`;
		case "delete_source":
			return `Delete ${action.source_path} — ${action.reason}`;
		case "skip":
			return `Skip ${action.source_path ?? "(no source)"}${
				action.reason === undefined || action.reason === null ? "" : ` — ${action.reason}`
			}`;
	}
}

/**
 * The vault note this action actually touches — what the user wants to open to
 * see WHY it failed (PRD F6). Exhaustive for the same reason as `actionIntent`.
 *
 * `link_to_moc` prefers `target_moc_path` over `target_moc` because that is the
 * precedence the executor itself resolves with (`planner.buildDependencyEdges`);
 * an unset path falls back to the stem, which `getFirstLinkpathDest` resolves
 * as a linktext just as well. `skip` may legitimately carry no source at all,
 * which is the one case that renders no link row.
 */
export function affectedNotePath(action: Action): string | null {
	switch (action.action) {
		case "create_moc":
		case "move_note":
			return action.destination;
		case "link_to_moc":
			return action.target_moc_path ?? action.target_moc;
		case "insert_under_marker":
		case "replace_section":
			return action.target_path;
		case "add_relationship":
			return action.target_moc_path;
		case "edit_note_text":
		case "remove_up_link":
		case "resolve_dead_link":
			return action.path;
		case "update_tracker":
		case "update_log_entry":
		case "update_log_link":
			return action.daily_note_path;
		case "delete_source":
			return action.source_path;
		case "skip":
			return action.source_path;
	}
}

/**
 * The "choose from the target note" button for a field that declares one, or
 * `undefined` for a plain free-text field.
 *
 * Only reachable on an `editable` card — `renderField` returns before this on
 * every other gate, so a frozen card has no button to press and no path into
 * either transform. The picks themselves are still validated on the write side
 * (`setAnchorSpot` re-checks the enums, `setTargetField` the whitelist); this
 * is the affordance, not the guard.
 *
 * Both picks commit more than one field at once and so cannot go through
 * `onChange(value)` — that is the whole reason `extraPick` exists as a bare
 * button rather than a second `TargetPickMode`. An anchor pick commits the
 * type/value/placement triple (`setAnchorSpot`); a marker pick commits
 * `marker` AND rewrites `line`'s PREFIX to match, preserving whatever follows
 * it (`setMarkerSpot` — see that function's docblock for the two prior,
 * wrong attempts at this and why each one was wrong). Neither commit can be
 * decomposed into independent per-field `onChange` calls without recreating
 * one of those wrong attempts.
 */
function extraPickFor(
	action: Action,
	field: TargetField,
	ctx: FixerCardContext,
): TargetControlCoreOptions["extraPick"] {
	if (field.spec.docPick === undefined) return undefined;

	if (field.spec.docPick === "anchor-spot") {
		const kind = anchorSpotKindOf(action);
		if (kind === null) return undefined; // unreachable — only anchor kinds declare it
		return {
			label: "Choose…",
			ariaLabel: "Choose an anchor from the target note",
			onClick: () => {
				void openAnchorSpotPicker(ctx.app, action, kind, (spot) => {
					ctx.apply((model) => setAnchorSpot(model, action.id, spot));
				});
			},
		};
	}

	return {
		label: "Choose…",
		ariaLabel: "Choose a marker from the target note",
		onClick: () => {
			void openMarkerSpotPicker(ctx.app, action, (spot) => {
				ctx.apply((model) => setMarkerSpot(model, action.id, spot.value));
			});
		},
	};
}

function renderField(
	container: HTMLElement,
	action: Action,
	field: TargetField,
	ctx: FixerCardContext,
): void {
	const row = container.createDiv({ cls: "hashi-if-field" });
	row.createEl("label", { text: field.spec.label });

	if (ctx.gate !== "editable") {
		// Decision 2 — a read-only card renders no control, not a disabled one.
		row.createSpan({
			cls: "hashi-if-field-value",
			text: field.value === "" ? "(empty)" : field.value,
		});
		return;
	}

	renderTargetControlCore(row, {
		app: ctx.app,
		value: field.value,
		caption: field.spec.caption,
		captionTooltip: field.spec.captionTooltip,
		placeholder: field.spec.placeholder,
		ariaLabel: field.spec.label,
		pick: field.spec.pick,
		extraPick: extraPickFor(action, field, ctx),
		onChange: (next) => {
			ctx.apply((model) => setTargetField(model, action.id, field.key, next));
		},
	});
}

/**
 * Renders one action's card body into `body`, in the binding order: intent →
 * failure reason → repair fields (editable only where the gate says so) → note
 * link. The reason sits directly under the intent it explains; its text is
 * derived by the view and arrives ready to render on `ctx.reason` (see
 * `fixerContract.ts` on why placement is the card's and meaning is the view's).
 */
export function renderActionCard(
	body: HTMLElement,
	action: Action,
	ctx: FixerCardContext,
): void {
	body.createDiv({ cls: "hashi-if-intent", text: actionIntent(action) });

	if (ctx.reason !== null) {
		body.createDiv({ cls: "hashi-if-card-reason", text: ctx.reason });
	}

	const fields = targetFieldsFor(action);
	if (fields.length > 0) {
		const wrap = body.createDiv({ cls: "hashi-if-fields" });
		for (const field of fields) renderField(wrap, action, field, ctx);
	}

	const notePath = affectedNotePath(action);
	if (notePath !== null && notePath !== "") {
		const row = body.createDiv({ cls: "hashi-if-note" });
		row.createSpan({ cls: "hashi-if-note-arrow", text: "→ " });
		// Reused verbatim from the Garden-Audit Editor: side-split open,
		// hover-preview via HOVER_LINK_SOURCE, inert "(note not found)" degrade.
		renderNavigableNoteLink(row, ctx.app, notePath);
	}
}

/** The `FixerCardRenderer` the view is wired with (main.ts). */
export const actionCardRenderer: FixerCardRenderer = { render: renderActionCard };
