/**
 * Op-1 "＋ Add MOC" fuzzy picker (SDD §7, PRD F2). Any vault note is a valid
 * MOC target — this picker only returns the chosen path; the owning tab
 * wires `onChoose` to `addMoc(model, suggestionId, path)`
 * (`source:"user"` is applied by that transform, not here).
 */

import type { App } from "obsidian";

import { VaultNotePicker } from "./VaultNotePicker.js";

export class MocPicker extends VaultNotePicker {
	constructor(app: App, onChoose: (path: string) => void) {
		super(app, onChoose, "Choose a MOC…");
	}
}
