import type { EditModel, TagGroupWire } from '../../types/suggestions';

/**
 * Pure EditModel transforms for tag-handler group toggles (SDD §6 Tag-Handler,
 * §5 TagGroup, PRD F9). A tag_handler_group has exactly two editable fields —
 * `approved` and `keep_source` — everything else (handler/target_path/marker/
 * source_paths/preview) is read-only display context sourced from Tomo and
 * must pass through untouched. There is no separate "skip" field: a group
 * with `approved: false` IS the skipped state.
 */

function updateTagGroupField<K extends 'approved' | 'keep_source'>(
	model: EditModel,
	groupId: string,
	field: K,
	value: TagGroupWire[K],
): EditModel {
	const groups = model.doc.tag_handler_groups;
	const target = groups.find((group) => group.group_id === groupId);

	// Unknown groupId or the value already matches — nothing to change.
	if (!target || target[field] === value) {
		return model;
	}

	return {
		...model,
		dirty: true,
		doc: {
			...model.doc,
			tag_handler_groups: groups.map((group) =>
				group.group_id === groupId ? { ...group, [field]: value } : group,
			),
		},
	};
}

/**
 * Sets a tag-handler group's `approved` flag. `approved: false` is the
 * skipped state — there is no separate skip field on the wire.
 */
export function setTagGroupApproved(model: EditModel, groupId: string, approved: boolean): EditModel {
	return updateTagGroupField(model, groupId, 'approved', approved);
}

/** Sets a tag-handler group's `keep_source` flag. */
export function setTagGroupKeepSource(model: EditModel, groupId: string, keepSource: boolean): EditModel {
	return updateTagGroupField(model, groupId, 'keep_source', keepSource);
}
