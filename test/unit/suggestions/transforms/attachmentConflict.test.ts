/**
 * Attachment-conflict transforms (#141, wire v4). Pure EditModel → EditModel,
 * keyed by the conflict's `source`. Every accepted case is paired with a
 * no-op / unknown-key case (Constitution L1), and the golden test proves the
 * editor produces exactly the save Tomo specified for its v4 release run.
 */

import { describe, expect, it } from "vitest";

import {
	conflictOwners,
	setConflictDir,
	setConflictName,
	setConflictRemedy,
} from "../../../../src/suggestions/transforms/attachmentConflict.js";
import { isFiled } from "../../../../src/suggestions/transforms/suggestion.js";
import type { EditModel, SuggestionsWire, SuggestionWire } from "../../../../src/types/suggestions.js";
import edited from "../../../fixtures/suggestions/v4-two-conflict-run.edited.json";
import emitted from "../../../fixtures/suggestions/v4-two-conflict-run.json";

const KARTE = "100 Inbox/Scans/karte.png";
const PLAN = "100 Inbox/Scans/plan.png";
const DEFAULT_DIR = "Atlas/290 Assets/295 Attachments";

const model = (): EditModel => ({ doc: structuredClone(emitted) as SuggestionsWire, dirty: false });
const conflict = (m: EditModel, source: string) => m.doc.attachment_conflicts.find((c) => c.source === source);

describe("setConflictRemedy", () => {
	it("sets the remedy and marks the model dirty, leaving the other conflict alone", () => {
		const before = model();
		const after = setConflictRemedy(before, KARTE, "ignore");

		expect(conflict(after, KARTE)?.remedy).toBe("ignore");
		expect(conflict(after, PLAN)).toEqual(conflict(before, PLAN));
		expect(after.dirty).toBe(true);
	});

	it("keeps a typed name and folder when switching away from Rename", () => {
		const renamed = setConflictName(setConflictDir(model(), KARTE, "Atlas/290 Assets/296 Maps"), KARTE, "karte.png");
		const kept = setConflictRemedy(renamed, KARTE, "keep_in_inbox");

		expect(conflict(kept, KARTE)).toMatchObject({
			remedy: "keep_in_inbox",
			proposed_name: "karte.png",
			proposed_dir: "Atlas/290 Assets/296 Maps",
		});
	});

	it("returns the same model for an unchanged remedy or an unknown source", () => {
		const m = model();
		expect(setConflictRemedy(m, KARTE, "rename")).toBe(m);
		expect(setConflictRemedy(m, "100 Inbox/nope.png", "ignore")).toBe(m);
	});
});

describe("setConflictName", () => {
	it("stores the sanitised name, never the raw input", () => {
		const after = setConflictName(model(), KARTE, "karte [alt].png");
		expect(conflict(after, KARTE)?.proposed_name).toBe("karte -alt-.png");
		expect(after.dirty).toBe(true);
	});

	it("refuses a blank name by returning the same model (the UI shows the error)", () => {
		const m = model();
		expect(setConflictName(m, KARTE, "   ")).toBe(m);
	});

	it("returns the same model when the sanitised name is unchanged or the source unknown", () => {
		const m = model();
		expect(setConflictName(m, KARTE, " karte (2).png ")).toBe(m);
		expect(setConflictName(m, "100 Inbox/nope.png", "x.png")).toBe(m);
	});
});

describe("setConflictDir", () => {
	it("writes a picked folder", () => {
		const after = setConflictDir(model(), KARTE, "Atlas/290 Assets/296 Maps");
		expect(conflict(after, KARTE)?.proposed_dir).toBe("Atlas/290 Assets/296 Maps");
		expect(after.dirty).toBe(true);
	});

	it("writes null when the default folder is picked back (Tomo's ruling: byte-identical to the emission)", () => {
		const moved = setConflictDir(model(), KARTE, "Atlas/290 Assets/296 Maps");
		const back = setConflictDir(moved, KARTE, DEFAULT_DIR);
		expect(conflict(back, KARTE)?.proposed_dir).toBeNull();
	});

	it("is a no-op when picking the default on an untouched conflict", () => {
		const m = model();
		expect(setConflictDir(m, KARTE, DEFAULT_DIR)).toBe(m);
		expect(setConflictDir(m, "100 Inbox/nope.png", "Atlas")).toBe(m);
	});

	it("pre-fills the original basename when Pass 1 found no free name (Tomo F1-AC11)", () => {
		const noName = setConflictRemedy(model(), KARTE, "rename");
		const seeded: EditModel = {
			...noName,
			doc: {
				...noName.doc,
				attachment_conflicts: noName.doc.attachment_conflicts.map((c) =>
					c.source === KARTE ? { ...c, proposed_name: null } : c,
				),
			},
		};
		const after = setConflictDir(seeded, KARTE, "Atlas/290 Assets/296 Maps");
		expect(conflict(after, KARTE)?.proposed_name).toBe("karte.png");
	});
});

describe("golden: Tomo's expected editor save for the v4 release run", () => {
	it("folder 296 Maps + name typed back reproduces .edited.json's attachment_conflicts", () => {
		const after = setConflictName(setConflictDir(model(), KARTE, "Atlas/290 Assets/296 Maps"), KARTE, "karte.png");
		expect(after.doc.attachment_conflicts).toEqual(edited.attachment_conflicts);
	});
});

describe("conflictOwners", () => {
	it("joins each conflict to every suggestion that embeds its source", () => {
		const owners = conflictOwners(model().doc);
		expect(owners.get(KARTE)?.map((s) => s.id)).toEqual(["S01", "S02"]);
		expect(owners.get(PLAN)?.map((s) => s.id)).toEqual(["S02"]);
	});
});

describe("isFiled", () => {
	const s = (over: Partial<SuggestionWire>): SuggestionWire => ({ ...(emitted.suggestions[0] as SuggestionWire), ...over });

	it.each([
		["worthy, approved", { decision: "approve" as const }, true],
		["worthy, skipped", { decision: "skip" as const }, false],
		["worthy, delete source", { decision: "skip" as const, delete_source: true }, false],
		["suppressed", { suppressed: true, force_atomic: false }, false],
		["suppressed, Force Atomic", { suppressed: true, force_atomic: true }, true],
	])("%s → %s", (_label, over, expected) => {
		expect(isFiled(s(over))).toBe(expected);
	});
});
