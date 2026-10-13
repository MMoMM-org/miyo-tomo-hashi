/**
 * The Attachments section of a suggestion card, with the attachment-conflict
 * control (#141, suggestions wire v4). Design: mockup rev 3,
 * `docs/XDD/specs/004-suggestions-editor/mockups/attachment-conflicts.html`.
 *
 * Lives beside SuggestionsTab rather than inside it: the card is already the
 * editor's largest surface, and this section has its own index (conflicts are
 * keyed by attachment `source`, shared by every card that embeds it).
 *
 * Rules carried over from the owner and Tomo:
 * - a conflict none of whose owners is filed is inert — every control is
 *   disabled, only the note's own controls (Force Atomic, decision) stay live;
 * - the folder is picked from existing folders, never typed;
 * - a name is committed sanitised on change; while typing, only the feedback
 *   line updates (a store apply would rebuild the tab and drop the caret);
 * - name and folder stay on the wire when the remedy leaves Rename.
 */

import type { TabContext } from "../tabContract.js";
import { basenameOf, dirnameOf, sanitiseAttachmentName } from "../../../suggestions/attachmentName.js";
import {
	conflictOwners,
	setConflictDir,
	setConflictName,
	setConflictRemedy,
	targetDirOf,
} from "../../../suggestions/transforms/attachmentConflict.js";
import { isFiled } from "../../../suggestions/transforms/suggestion.js";
import type {
	AttachmentConflictRemedy,
	AttachmentConflictWire,
	SuggestionsWire,
	SuggestionWire,
} from "../../../types/suggestions.js";
import { AttachmentFolderPicker } from "../pickers/AttachmentFolderPicker.js";

/** Built once per render: conflicts by source, and each conflict's owning suggestions. */
export interface AttachmentIndex {
	readonly conflicts: ReadonlyMap<string, AttachmentConflictWire>;
	readonly owners: ReadonlyMap<string, readonly SuggestionWire[]>;
}

export function buildAttachmentIndex(doc: SuggestionsWire): AttachmentIndex {
	return {
		conflicts: new Map(doc.attachment_conflicts.map((c) => [c.source, c])),
		owners: conflictOwners(doc),
	};
}

const REMEDY_LEGS: ReadonlyArray<readonly [AttachmentConflictRemedy, string, string]> = [
	["rename", "Rename", "hashi-se-rename"],
	["keep_in_inbox", "Keep in inbox", "hashi-se-keep"],
	["ignore", "Ignore", "hashi-se-ignore"],
];

const REMEDY_HINT: Record<AttachmentConflictRemedy, (target: string) => string> = {
	rename: (target) => `The attachment moves to ${target}, and the note's embed is rewritten to it.`,
	keep_in_inbox: () => "The attachment stays in the inbox, and the filed note embeds it there.",
	ignore: () =>
		"The move is sent unchanged. If the destination is still taken it fails, and the source note stays in the inbox.",
};

const INERT_HINT =
	"No note embedding this file is being filed, so the remedy has no effect. Only the note's own controls apply.";

export function renderAttachmentsSection(
	container: HTMLElement,
	suggestion: SuggestionWire,
	index: AttachmentIndex,
	ctx: TabContext,
): void {
	const section = container.createDiv({ cls: "hashi-se-attachments" });
	const count = suggestion.attachments.length;
	const label = section.createDiv({ cls: "hashi-se-sec-label", text: count === 0 ? "Attachments" : `Attachments · ${count}` });
	if (count === 0) {
		label.createSpan({ cls: "hashi-se-muted", text: " — none" });
		return;
	}

	const filed = isFiled(suggestion);
	for (const source of suggestion.attachments) {
		const conflict = index.conflicts.get(source);
		const row = section.createDiv({ cls: "hashi-se-att", attr: { "data-attachment": source } });
		const line = row.createDiv({ cls: "hashi-se-att-line" });
		const path = line.createSpan({ cls: "hashi-se-att-path" });
		const dir = dirnameOf(source);
		if (dir !== "") path.createSpan({ cls: "hashi-se-muted", text: `${dir}/` });
		path.createSpan({ text: basenameOf(source) });
		if (conflict !== undefined) line.createSpan({ cls: ["hashi-se-badge", "hashi-se-badge-conflict"], text: "destination taken" });
		const fate = !filed ? "stays in inbox with the note" : conflict === undefined ? "filed with the note" : "";
		if (fate !== "") line.createSpan({ cls: "hashi-se-att-fate", text: fate });

		if (conflict !== undefined) {
			renderConflictBox(row, conflict, index.owners.get(source) ?? [], ctx);
		}
	}
}

function renderConflictBox(
	row: HTMLElement,
	conflict: AttachmentConflictWire,
	owners: readonly SuggestionWire[],
	ctx: TabContext,
): void {
	const live = owners.some(isFiled);
	const box = row.createDiv({ cls: live ? ["hashi-se-conflict-box"] : ["hashi-se-conflict-box", "is-inert"] });

	const occupied = box.createDiv({ cls: "hashi-se-occupied", text: "Destination taken: " });
	occupied.createEl("code", { text: conflict.destination });
	if (owners.length > 1) {
		occupied.createSpan({
			cls: ["hashi-se-badge", "hashi-se-badge-shared"],
			text: `shared by ${owners.length} notes`,
			attr: { title: owners.map((o) => `${o.id} · ${o.title}`).join("\n"), tabindex: "0" },
		});
	}
	box.createDiv({ cls: "hashi-se-same", text: sameFileSentence(conflict.same_file) });

	const remedyRow = box.createDiv({ cls: "hashi-se-remedy-row" });
	const remedyField = remedyRow.createDiv({ cls: "hashi-se-field" });
	remedyField.createEl("label", { text: "Remedy" });
	const segment = remedyField.createDiv({ cls: live ? ["hashi-se-decision"] : ["hashi-se-decision", "is-disabled"] });
	for (const [remedy, text, cls] of REMEDY_LEGS) {
		const active = conflict.remedy === remedy;
		const button = segment.createEl("button", {
			cls: active ? [cls, "is-active"] : [cls],
			text,
			attr: { type: "button", "aria-pressed": String(active) },
		});
		button.disabled = !live;
		button.addEventListener("click", () => {
			ctx.apply((model) => setConflictRemedy(model, conflict.source, remedy));
		});
	}

	if (conflict.remedy === "rename") {
		const target = remedyRow.createDiv({ cls: "hashi-se-target-row" });

		const folderField = target.createDiv({ cls: "hashi-se-field" });
		folderField.createEl("label", { text: "Folder" });
		const folderButton = folderField.createEl("button", {
			cls: "hashi-se-mini-pick",
			text: targetDirOf(conflict),
			attr: { type: "button", "aria-label": "Folder the renamed attachment moves to" },
		});
		folderButton.disabled = !live;
		folderButton.addEventListener("click", () => {
			new AttachmentFolderPicker(
				ctx.app,
				(dir) => ctx.apply((model) => setConflictDir(model, conflict.source, dir)),
				ctx.pickerScopes?.inboxFolder ?? "",
			).open();
		});

		const nameField = target.createDiv({ cls: ["hashi-se-field", "hashi-se-spacer"] });
		nameField.createEl("label", { text: "Name" });
		const input = nameField.createEl("input", {
			cls: ["hashi-se-inp", "hashi-se-mono"],
			attr: { type: "text", value: conflict.proposed_name ?? "", "aria-label": "New attachment filename" },
		});
		input.disabled = !live;

		if (live) {
			const feedback = box.createDiv({ cls: "hashi-se-feedback" });
			const show = (raw: string): void => renderNameFeedback(feedback, input, conflict, raw, ctx);
			show(input.value);
			input.addEventListener("input", () => show(input.value));
			input.addEventListener("change", () => {
				const raw = input.value;
				ctx.apply((model) => setConflictName(model, conflict.source, raw));
			});
		}
	}

	const hint = live
		? REMEDY_HINT[conflict.remedy](
				`${targetDirOf(conflict)}/${sanitiseAttachmentName(conflict.proposed_name ?? "").cleaned}`,
			)
		: INERT_HINT;
	box.createDiv({ cls: "hashi-se-remedy-hint", text: hint });
}

function sameFileSentence(sameFile: boolean | null): string {
	if (sameFile === true) return "Identical file, same bytes.";
	if (sameFile === false) return "A different file with the same name.";
	return "Not compared.";
}

/**
 * The line under the Name field, recomputed on every keystroke from vault
 * state: blank is an error (the transform refuses it), an occupied target a
 * warning (Tomo's Pass 2 will hold the attachment), otherwise information —
 * what the sanitiser changed, and whether the basename also exists elsewhere
 * so Tomo writes the embed with its full path (our A1 measurement).
 */
function renderNameFeedback(
	el: HTMLElement,
	input: HTMLInputElement,
	conflict: AttachmentConflictWire,
	raw: string,
	ctx: TabContext,
): void {
	el.empty();
	el.removeClass("is-error", "is-warning", "is-info");
	const { cleaned, changed } = sanitiseAttachmentName(raw);
	input.classList.toggle("is-invalid", cleaned === "");

	if (cleaned === "") {
		el.addClass("is-error");
		el.setText("Enter a name to rename the attachment.");
		return;
	}

	const target = `${targetDirOf(conflict)}/${cleaned}`;
	if (ctx.app.vault.getAbstractFileByPath(target)) {
		el.addClass("is-warning");
		el.setText(`${target} is already taken. Tomo will hold the attachment at Pass 2.`);
		return;
	}

	el.addClass("is-info");
	if (changed) {
		el.createDiv({
			text: `Will be saved as ${cleaned}. Characters that can't be in a filename or would break the embed became "-".`,
		});
	}
	const lower = cleaned.toLowerCase();
	const elsewhere = ctx.app.vault
		.getFiles()
		.find((file) => file.path !== target && file.path !== conflict.source && file.name.toLowerCase() === lower);
	if (elsewhere !== undefined) {
		el.createDiv({
			text: `${cleaned} also exists elsewhere (${elsewhere.path}), so the embed will carry the full path.`,
		});
	}
}
