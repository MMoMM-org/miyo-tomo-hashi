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
 * Union two member_ids lists by id, deduping. `base`'s members come first
 * (order preserved), followed by any `incoming` ids not already present —
 * this is the shared merge kernel for both `mergeProposedMocs` and the
 * same-name collapse. Because the result starts as a copy of `base` and
 * only ever appends ids from `incoming` (never removes any), the union is
 * structurally guaranteed to be a superset of both inputs — orphaning a
 * member id here is not a runtime risk to guard against, it's ruled out by
 * construction. The "never orphan an id" intent is proven by the
 * `mergeProposedMocs` test that asserts every pre-merge member id from both
 * source and target survives into the merged result.
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

	const proposedMocs = model.doc.proposed_mocs
		.filter((moc) => moc.id !== sourceId)
		.map((moc) => (moc.id === targetId ? { ...moc, member_ids: mergedMemberIds } : moc));

	return { doc: { ...model.doc, proposed_mocs: proposedMocs }, dirty: true };
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
