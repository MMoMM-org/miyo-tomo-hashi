/**
 * Proposed-MOC graph-op transforms (T1.5, SDD §6 Proposed MOCs, ADR-026 §5
 * id-based refs, PRD F4): rename, reparent, decision-flip, and merge.
 *
 * All transforms are pure `EditModel → EditModel`. `ProposedMocWire` fields
 * are deeply `readonly`, so every edit builds a NEW `EditModel`/doc/node
 * rather than mutating in place — the original model passed in is always
 * left untouched, and `dirty` is only ever set true on a successful edit.
 * Proposed MOCs are addressed by their stable `id` (M##); `member_ids`
 * reference suggestion S## ids and are the unit merges operate over.
 */

import type { EditModel, ProposedMocWire } from "../../types/suggestions.js";

function withProposedMocs(model: EditModel, proposedMocs: readonly ProposedMocWire[]): EditModel {
	return {
		doc: { ...model.doc, proposed_mocs: proposedMocs },
		dirty: true,
	};
}

function findProposedMoc(model: EditModel, mocId: string): ProposedMocWire | undefined {
	return model.doc.proposed_mocs.find((moc) => moc.id === mocId);
}

function updateProposedMoc(
	model: EditModel,
	mocId: string,
	update: (moc: ProposedMocWire) => ProposedMocWire,
): EditModel {
	if (findProposedMoc(model, mocId) === undefined) {
		return model;
	}
	const proposedMocs = model.doc.proposed_mocs.map((moc) => (moc.id === mocId ? update(moc) : moc));
	return withProposedMocs(model, proposedMocs);
}

/** Rename a proposed MOC. Membership and every other field is unchanged. */
export function renameProposedMoc(model: EditModel, mocId: string, name: string): EditModel {
	return updateProposedMoc(model, mocId, (moc) => ({ ...moc, name }));
}

/** Reparent a proposed MOC (fuzzy target — free text). */
export function reparentProposedMoc(model: EditModel, mocId: string, parent: string): EditModel {
	return updateProposedMoc(model, mocId, (moc) => ({ ...moc, parent }));
}

/** Flip a proposed MOC's approve/skip decision. */
export function setProposedMocDecision(
	model: EditModel,
	mocId: string,
	decision: ProposedMocWire["decision"],
): EditModel {
	return updateProposedMoc(model, mocId, (moc) => ({ ...moc, decision }));
}

/**
 * Union two member_ids lists by id, deduping. `base`'s members come first
 * (order preserved), followed by any `incoming` ids not already present —
 * this is the shared merge kernel for both `mergeProposedMocs` and the
 * same-name collapse, and its output-contains-both-inputs property is what
 * `mergeProposedMocs`'s "never orphan a member id" guard verifies below.
 */
function unionMemberIds(base: readonly string[], incoming: readonly string[]): readonly string[] {
	const merged = [...base];
	for (const id of incoming) {
		if (!merged.includes(id)) {
			merged.push(id);
		}
	}
	return merged;
}

/**
 * Merge `sourceId` into `targetId`: union member_ids by id (deduped, target's
 * members first), then drop the source node. Rejects a self-merge or either
 * id being unknown — unchanged model, dirty false.
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

	const mergedMemberIds = unionMemberIds(target.member_ids, source.member_ids);

	// Guard: a merge must never drop a member id — the union must contain
	// every id from both source and target.
	const missing = [...source.member_ids, ...target.member_ids].filter((id) => !mergedMemberIds.includes(id));
	if (missing.length > 0) {
		throw new Error(
			`mergeProposedMocs: merge of ${sourceId} into ${targetId} would orphan member id(s): ${missing.join(", ")}`,
		);
	}

	const proposedMocs = model.doc.proposed_mocs
		.filter((moc) => moc.id !== sourceId)
		.map((moc) => (moc.id === targetId ? { ...moc, member_ids: mergedMemberIds } : moc));

	return withProposedMocs(model, proposedMocs);
}

/**
 * "Merge into…" same-name collapse: find another proposed MOC that shares
 * `mocId`'s `name` and merge them. Rejects when `mocId` is unknown or no
 * other node shares its name — unchanged model, dirty false.
 */
export function mergeSameNameProposedMocs(model: EditModel, mocId: string): EditModel {
	const moc = findProposedMoc(model, mocId);
	if (moc === undefined) {
		return model;
	}
	const duplicate = model.doc.proposed_mocs.find((other) => other.id !== mocId && other.name === moc.name);
	if (duplicate === undefined) {
		return model;
	}
	return mergeProposedMocs(model, duplicate.id, mocId);
}
