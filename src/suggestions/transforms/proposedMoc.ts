/**
 * Proposed-MOC graph-op transforms (T1.5, SDD §6 Proposed MOCs, ADR-026 §5
 * id-based refs, PRD F4): rename, reparent, decision-flip, and merge.
 *
 * All transforms are pure `EditModel → EditModel`. `ProposedMocWire` fields
 * are deeply `readonly`, so every edit builds a NEW `EditModel`/doc/node
 * rather than mutating in place — the original model passed in is always
 * left untouched, and `dirty` is only ever set true on a real change.
 * Proposed MOCs are addressed by their stable `id` (M##); `member_ids`
 * reference suggestion S## ids and are the unit merges operate over.
 *
 * No-op gating mirrors `transforms/suggestion.ts`'s `updateSuggestion`
 * convention: `updateProposedMoc`'s `update()` callback returns `null` to
 * report "no real change" (e.g. renaming to the same name), and the shared
 * helper returns the SAME `model` reference — not merely an equal one — so
 * callers can cheaply detect "nothing changed" with `===`, and `dirty` is
 * never flipped true for a same-value call.
 */

import type { EditModel, ProposedMocWire } from "../../types/suggestions.js";

function findProposedMoc(model: EditModel, mocId: string): ProposedMocWire | undefined {
	return model.doc.proposed_mocs.find((moc) => moc.id === mocId);
}

/**
 * Locates the proposed MOC by id and applies `update` to produce its
 * replacement. Returns the model unchanged (same reference, dirty
 * untouched) when the id is unknown or `update` reports no real change.
 */
function updateProposedMoc(
	model: EditModel,
	mocId: string,
	update: (moc: ProposedMocWire) => ProposedMocWire | null,
): EditModel {
	const current = findProposedMoc(model, mocId);
	if (current === undefined) return model;

	const next = update(current);
	if (next === null) return model;

	const proposedMocs = model.doc.proposed_mocs.map((moc) => (moc.id === mocId ? next : moc));
	return { doc: { ...model.doc, proposed_mocs: proposedMocs }, dirty: true };
}

/** Rename a proposed MOC. No-op if unchanged. Membership is untouched either way. */
export function renameProposedMoc(model: EditModel, mocId: string, name: string): EditModel {
	return updateProposedMoc(model, mocId, (moc) => {
		if (moc.name === name) return null;
		return { ...moc, name };
	});
}

/** Reparent a proposed MOC (fuzzy target — free text). No-op if unchanged. */
export function reparentProposedMoc(model: EditModel, mocId: string, parent: string): EditModel {
	return updateProposedMoc(model, mocId, (moc) => {
		if (moc.parent === parent) return null;
		return { ...moc, parent };
	});
}

/** Flip a proposed MOC's approve/skip decision. No-op if unchanged. */
export function setProposedMocDecision(
	model: EditModel,
	mocId: string,
	decision: ProposedMocWire["decision"],
): EditModel {
	return updateProposedMoc(model, mocId, (moc) => {
		if (moc.decision === decision) return null;
		return { ...moc, decision };
	});
}

/**
 * Union two string lists, deduping. `base`'s entries come first (order
 * preserved), followed by any `incoming` entries not already present. Used by
 * `mergeProposedMocs` for both `member_ids` and `tags`. Because the result
 * starts as a copy of `base` and only ever appends from `incoming` (never
 * removes any), it is structurally a superset of both inputs — orphaning an
 * entry is ruled out by construction, and the `mergeProposedMocs` test asserts
 * every pre-merge member id from both source and target survives the merge.
 */
function unionStrings(base: readonly string[], incoming: readonly string[]): readonly string[] {
	const merged = [...base];
	for (const value of incoming) {
		if (!merged.includes(value)) {
			merged.push(value);
		}
	}
	return merged;
}

/**
 * Retarget the leading "N note[s]" member count in a Tomo reason string to
 * `count` (fixing pluralization). Tomo emits reasons like "1 note share topic
 * X and have no dedicated MOC."; after a merge grows the member list, that
 * count is stale, so the merged card shows the wrong number. Only the leading
 * count token is rewritten — if the reason doesn't start with `<digits> note`
 * (absent, or a non-standard/localized wording) it is returned unchanged, so
 * Hashi never mangles the rest of Tomo's copy.
 */
function retargetReasonCount(reason: string | undefined, count: number): string | undefined {
	if (reason === undefined) return reason;
	const noun = count === 1 ? "note" : "notes";
	return reason.replace(/^\d+\s+notes?/i, `${count} ${noun}`);
}

/**
 * Merge `sourceId` into `targetId`: union `member_ids` and `tags` (deduped,
 * target's first), retarget the target's reason count to the merged member
 * count, then drop the source node. Rejects a self-merge or either id being
 * unknown — unchanged model, dirty false. Tags stay absent when neither side
 * had any (an empty union does not fabricate a `tags: []`).
 */
export function mergeProposedMocs(model: EditModel, sourceId: string, targetId: string): EditModel {
	if (sourceId === targetId) {
		return model;
	}
	const source = findProposedMoc(model, sourceId);
	const target = findProposedMoc(model, targetId);
	if (source === undefined || target === undefined) {
		return model;
	}

	const mergedMemberIds = unionStrings(target.member_ids, source.member_ids);
	const mergedTags = unionStrings(target.tags ?? [], source.tags ?? []);

	const proposedMocs = model.doc.proposed_mocs
		.filter((moc) => moc.id !== sourceId)
		.map((moc) =>
			moc.id === targetId
				? {
						...moc,
						member_ids: mergedMemberIds,
						tags: mergedTags.length > 0 ? mergedTags : moc.tags,
						reason: retargetReasonCount(moc.reason, mergedMemberIds.length),
					}
				: moc,
		);

	return { doc: { ...model.doc, proposed_mocs: proposedMocs }, dirty: true };
}
