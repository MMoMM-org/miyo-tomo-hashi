import { describe, it, expect } from 'vitest';
import { setTagGroupApproved, setTagGroupKeepSource } from '../../../../src/suggestions/transforms/tagHandler';
import { FakeSuggestionsDoc } from '../../../__mocks__/FakeSuggestionsDoc';
import type { EditModel, TagGroupWire } from '../../../../src/types/suggestions';

// Fresh-state factory — a 2-group seed isolated from the real-Tomo fixture,
// used where the test needs to prove one group's toggle leaves siblings
// untouched (the shared 1115 fixture only has one tag_handler_group).
function getMockTagGroup(overrides?: Partial<TagGroupWire>): TagGroupWire {
	return {
		group_id: 'th-group-a',
		approved: true,
		keep_source: false,
		handler: 'tsukai',
		target_path: 'Efforts/Group A.md',
		marker: '## Captures',
		source_paths: ['100 Inbox/a.md'],
		preview: '| 2026-07-06 | feature | group a preview |',
		...overrides,
	};
}

function getMockTwoGroupModel(): EditModel {
	return {
		dirty: false,
		doc: {
			schema_version: '1',
			generated: '2026-07-06T11:15:00Z',
			run_id: 'test-run',
			profile: 'default',
			source_items: 2,
			emit_digest: `sha256:${'a'.repeat(64)}`,
			suggestions: [],
			proposed_mocs: [],
			daily_updates: [],
			tag_handler_groups: [
				getMockTagGroup({ group_id: 'th-group-a' }),
				getMockTagGroup({
					group_id: 'th-group-b',
					approved: false,
					keep_source: true,
					handler: 'other-handler',
					target_path: 'Efforts/Group B.md',
					marker: '## Other',
					source_paths: ['100 Inbox/b.md'],
					preview: '| 2026-07-06 | feature | group b preview |',
				}),
			],
		},
	};
}

describe('setTagGroupApproved', () => {
	it('sets approved true→false and marks the model dirty', () => {
		const model = getMockTwoGroupModel();

		const result = setTagGroupApproved(model, 'th-group-a', false);

		expect(result.dirty).toBe(true);
		const group = result.doc.tag_handler_groups.find((g) => g.group_id === 'th-group-a');
		expect(group?.approved).toBe(false);
	});

	it('reads a not-approved group as skipped (approved===false, no separate skip field)', () => {
		const model = getMockTwoGroupModel();

		const result = setTagGroupApproved(model, 'th-group-a', false);

		const group = result.doc.tag_handler_groups.find((g) => g.group_id === 'th-group-a');
		expect(group).not.toHaveProperty('skip');
		expect(group?.approved).toBe(false);
	});

	it('leaves read-only display context untouched', () => {
		const model = getMockTwoGroupModel();
		const before = model.doc.tag_handler_groups.find((g) => g.group_id === 'th-group-a');

		const result = setTagGroupApproved(model, 'th-group-a', false);

		const after = result.doc.tag_handler_groups.find((g) => g.group_id === 'th-group-a');
		expect(after?.handler).toEqual(before?.handler);
		expect(after?.target_path).toEqual(before?.target_path);
		expect(after?.marker).toEqual(before?.marker);
		expect(after?.source_paths).toEqual(before?.source_paths);
		expect(after?.preview).toEqual(before?.preview);
	});

	it('leaves unrelated groups unaffected (isolation)', () => {
		const model = getMockTwoGroupModel();
		const untouchedBefore = model.doc.tag_handler_groups.find((g) => g.group_id === 'th-group-b');

		const result = setTagGroupApproved(model, 'th-group-a', false);

		const untouchedAfter = result.doc.tag_handler_groups.find((g) => g.group_id === 'th-group-b');
		expect(untouchedAfter).toEqual(untouchedBefore);
	});

	it('returns an unchanged, non-dirty model for an unknown groupId', () => {
		const model = getMockTwoGroupModel();

		const result = setTagGroupApproved(model, 'th-group-does-not-exist', false);

		expect(result.dirty).toBe(false);
		expect(result.doc.tag_handler_groups).toEqual(model.doc.tag_handler_groups);
	});

	it('is a no-op (dirty false) when setting the same value already present', () => {
		const model = getMockTwoGroupModel();

		const result = setTagGroupApproved(model, 'th-group-a', true);

		expect(result.dirty).toBe(false);
		expect(result.doc.tag_handler_groups).toEqual(model.doc.tag_handler_groups);
	});

	it('does not mutate the original model or doc', () => {
		const model = getMockTwoGroupModel();
		const originalGroups = model.doc.tag_handler_groups;
		const originalGroupA = originalGroups[0];

		setTagGroupApproved(model, 'th-group-a', false);

		expect(model.dirty).toBe(false);
		expect(model.doc.tag_handler_groups).toBe(originalGroups);
		expect(originalGroupA?.approved).toBe(true);
	});

	it('works against the real Tomo fixture via FakeSuggestionsDoc', async () => {
		const model = await new FakeSuggestionsDoc().load('x');
		const groupId = model.doc.tag_handler_groups[0]?.group_id;
		expect(groupId).toBeDefined();

		const result = setTagGroupApproved(model, groupId as string, false);

		expect(result.dirty).toBe(true);
		expect(result.doc.tag_handler_groups.find((g) => g.group_id === groupId)?.approved).toBe(false);
	});
});

describe('setTagGroupKeepSource', () => {
	it('sets keep_source false→true and marks the model dirty', () => {
		const model = getMockTwoGroupModel();

		const result = setTagGroupKeepSource(model, 'th-group-a', true);

		expect(result.dirty).toBe(true);
		const group = result.doc.tag_handler_groups.find((g) => g.group_id === 'th-group-a');
		expect(group?.keep_source).toBe(true);
	});

	it('leaves read-only display context untouched', () => {
		const model = getMockTwoGroupModel();
		const before = model.doc.tag_handler_groups.find((g) => g.group_id === 'th-group-a');

		const result = setTagGroupKeepSource(model, 'th-group-a', true);

		const after = result.doc.tag_handler_groups.find((g) => g.group_id === 'th-group-a');
		expect(after?.handler).toEqual(before?.handler);
		expect(after?.target_path).toEqual(before?.target_path);
		expect(after?.marker).toEqual(before?.marker);
		expect(after?.source_paths).toEqual(before?.source_paths);
		expect(after?.preview).toEqual(before?.preview);
	});

	it('leaves unrelated groups unaffected (isolation)', () => {
		const model = getMockTwoGroupModel();
		const untouchedBefore = model.doc.tag_handler_groups.find((g) => g.group_id === 'th-group-b');

		const result = setTagGroupKeepSource(model, 'th-group-a', true);

		const untouchedAfter = result.doc.tag_handler_groups.find((g) => g.group_id === 'th-group-b');
		expect(untouchedAfter).toEqual(untouchedBefore);
	});

	it('returns an unchanged, non-dirty model for an unknown groupId', () => {
		const model = getMockTwoGroupModel();

		const result = setTagGroupKeepSource(model, 'th-group-does-not-exist', true);

		expect(result.dirty).toBe(false);
		expect(result.doc.tag_handler_groups).toEqual(model.doc.tag_handler_groups);
	});

	it('is a no-op (dirty false) when setting the same value already present', () => {
		const model = getMockTwoGroupModel();

		const result = setTagGroupKeepSource(model, 'th-group-a', false);

		expect(result.dirty).toBe(false);
		expect(result.doc.tag_handler_groups).toEqual(model.doc.tag_handler_groups);
	});

	it('does not mutate the original model or doc', () => {
		const model = getMockTwoGroupModel();
		const originalGroups = model.doc.tag_handler_groups;
		const originalGroupA = originalGroups[0];

		setTagGroupKeepSource(model, 'th-group-a', true);

		expect(model.dirty).toBe(false);
		expect(model.doc.tag_handler_groups).toBe(originalGroups);
		expect(originalGroupA?.keep_source).toBe(false);
	});
});
