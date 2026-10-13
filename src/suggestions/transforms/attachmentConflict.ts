/**
 * Attachment-conflict transforms (#141, suggestions wire v4).
 *
 * `attachment_conflicts[]` holds one entry per colliding attachment, keyed by
 * `source` and shared by every suggestion that embeds it — so an edit made on
 * either owning card is the same edit. Three fields are editable: `remedy`,
 * `proposed_name` and `proposed_dir`. Each has exactly one writer here.
 *
 * Same conventions as `proposedMoc.ts`: pure `EditModel → EditModel`, and a
 * rejected or same-value call returns the SAME model reference so the store
 * neither notifies nor flips `dirty`.
 *
 * Name and folder are kept when the owner switches away from Rename (Tomo
 * ignores them there), so switching back restores what was typed.
 */

import type {
	AttachmentConflictRemedy,
	AttachmentConflictWire,
	EditModel,
	SuggestionsWire,
	SuggestionWire,
} from "../../types/suggestions.js";
import { basenameOf, dirnameOf, sanitiseAttachmentName } from "../attachmentName.js";

function updateConflict(
	model: EditModel,
	source: string,
	update: (conflict: AttachmentConflictWire) => AttachmentConflictWire | null,
): EditModel {
	const current = model.doc.attachment_conflicts.find((c) => c.source === source);
	if (current === undefined) return model;

	const next = update(current);
	if (next === null) return model;

	const conflicts = model.doc.attachment_conflicts.map((c) => (c.source === source ? next : c));
	return { doc: { ...model.doc, attachment_conflicts: conflicts }, dirty: true };
}

/** Sets how the conflict is resolved. Name and folder are left as they are. */
export function setConflictRemedy(model: EditModel, source: string, remedy: AttachmentConflictRemedy): EditModel {
	return updateConflict(model, source, (c) => (c.remedy === remedy ? null : { ...c, remedy }));
}

/**
 * Sets the rename target's basename — always the sanitised form, so the wire
 * carries exactly what the owner saw under the field. Blank is refused (no-op);
 * the UI shows the error and the wire keeps the last valid name.
 */
export function setConflictName(model: EditModel, source: string, raw: string): EditModel {
	const { cleaned } = sanitiseAttachmentName(raw);
	if (cleaned === "") return model;
	return updateConflict(model, source, (c) => (c.proposed_name === cleaned ? null : { ...c, proposed_name: cleaned }));
}

/**
 * Sets the rename target's folder from the picker. Picking the destination's
 * own folder — Tomo's configured asset folder — writes `null`, so an
 * untouched-looking conflict stays byte-identical to Tomo's emission (Tomo
 * ruling 2026-10-12). With no free name from Pass 1, the original basename is
 * pre-filled: Tomo never fills one in, and a folder without a name is refused
 * as blank (their F1-AC11).
 */
export function setConflictDir(model: EditModel, source: string, dir: string): EditModel {
	return updateConflict(model, source, (c) => {
		const proposedDir = dir === dirnameOf(c.destination) ? null : dir;
		const proposedName = c.proposed_name ?? basenameOf(c.source);
		if (c.proposed_dir === proposedDir && c.proposed_name === proposedName) return null;
		return { ...c, proposed_dir: proposedDir, proposed_name: proposedName };
	});
}

/** The folder a Rename moves the attachment to: the picked one, else the destination's. */
export function targetDirOf(conflict: AttachmentConflictWire): string {
	return conflict.proposed_dir ?? dirnameOf(conflict.destination);
}

/** Every suggestion that embeds each conflict's source — the conflict's owners. */
export function conflictOwners(doc: SuggestionsWire): ReadonlyMap<string, readonly SuggestionWire[]> {
	const owners = new Map<string, SuggestionWire[]>();
	for (const conflict of doc.attachment_conflicts) {
		owners.set(
			conflict.source,
			doc.suggestions.filter((s) => s.attachments.includes(conflict.source)),
		);
	}
	return owners;
}
