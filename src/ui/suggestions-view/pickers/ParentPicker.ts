/**
 * Proposed-MOC "parent" fuzzy picker (SDD §7, PRD F4/F6). Item source
 * mirrors `MocPicker` (any vault note/MOC path) — the owning tab wires
 * `onChoose` to the proposed MOC's parent field.
 */

import type { App } from "obsidian";

import { VaultNotePicker } from "./VaultNotePicker.js";

export class ParentPicker extends VaultNotePicker {
	constructor(app: App, onChoose: (parentPath: string) => void) {
		super(app, onChoose, "Choose a parent…");
	}
}
