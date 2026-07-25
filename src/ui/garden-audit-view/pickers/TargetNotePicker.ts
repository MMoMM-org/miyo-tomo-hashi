/**
 * Fix-target fuzzy picker for `TargetControl` (spec-005 Phase 5, T5.1;
 * SDD ADR-3). Item source mirrors `MocPicker`/`ParentPicker` (any vault note
 * is a valid pick target — dead_link/broken_up/orphan/unparented targets are
 * all "some other note in the vault", same as a MOC or parent pick) — this
 * picker only reports the chosen path; `TargetControl` decides what to do
 * with it (populate the input + fire `onChange`).
 */

import type { App } from "obsidian";

import { VaultNotePicker } from "../../suggestions-view/pickers/VaultNotePicker.js";

export class TargetNotePicker extends VaultNotePicker {
	constructor(app: App, onChoose: (path: string) => void) {
		super(app, onChoose, "Choose a target note…");
	}
}
