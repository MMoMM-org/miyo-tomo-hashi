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
import { setTargetField } from "../../../instruction-fixer/transforms.js";
import { renderNavigableNoteLink } from "../../garden-audit-view/noteNavigation.js";
import { renderTargetControlCore } from "../../garden-audit-view/TargetControl.js";
import type { FixerCardContext, FixerCardRenderer } from "../fixerContract.js";

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
 */
export function actionIntent(action: Action): string {
	switch (action.action) {
		case "create_moc":
			return `Create MOC ${quote(action.title)} at ${action.destination}`;
		case "move_note":
			return `Move ${action.source} → ${action.destination}`;
		case "link_to_moc":
			return `Link into ${action.target_moc}, ${action.placement} ${action.anchor.type} ${anchorText(action.anchor.value)}`;
		case "insert_under_marker":
			return `Insert into ${action.target_path}, ${action.placement} ${action.anchor.type} ${anchorText(action.anchor.value)}`;
		case "replace_section":
			return `Replace section ${anchorText(action.anchor.value)} in ${action.target_path}`;
		case "add_relationship":
			return `Add ${quote(action.line)} under ${action.marker} in ${action.target_moc_path}`;
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
		onChange: (next) => {
			ctx.apply((model) => setTargetField(model, action.id, field.key, next));
		},
	});
}

/**
 * Renders one action's card body into `body`: intent, repair fields (editable
 * only where the gate says so), then the note link.
 */
export function renderActionCard(
	body: HTMLElement,
	action: Action,
	ctx: FixerCardContext,
): void {
	body.createDiv({ cls: "hashi-if-intent", text: actionIntent(action) });

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
