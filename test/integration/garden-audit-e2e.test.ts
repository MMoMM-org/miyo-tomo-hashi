/**
 * End-to-end integration test for the Garden-Audit Editor (spec-005 Phase 7,
 * T7.2; SDD Runtime View, Quality Requirements). Drives the WHOLE stack for
 * real: `GardenAuditEditorView` (the real `ItemView`) → the real
 * `GardenAuditTab` rendering real DOM cards → `ObsidianGardenAuditDoc` (the
 * real adapter) backed by `FakeVaultFS` → the real `garden-audit-validator`.
 * Mirrors `test/integration/suggestions-editor-e2e.test.ts`'s real-stack idiom
 * (no component mocked) applied to the garden-audit surface's own shape: one
 * tier-grouped tab, four fixable check types (dead_link/broken_up/orphan/
 * unparented), and no sibling `.md` write (ADR-6).
 *
 * Fixtures:
 *   - `test/fixtures/garden-audit/current-wire.json` — the T1.3 real
 *     `build_wire_payload` output (anonymized), EXTENDED here with one
 *     minimal F04 `unparented` finding (mirroring F03 orphan's shape
 *     exactly) so all four fixable check types are covered — the fixture
 *     previously had none. `emit_digest` is left as-is (Hashi never
 *     recomputes it — carrying it byte-identical is exactly what this suite
 *     proves).
 *   - `test/fixtures/garden-audit/stale-pre030-wire.json` — a SYNTHETIC
 *     minimal wire (anonymous "Note A" / "020 Example MOC" paths, never the
 *     real gitignored test vault) reproducing the pre-spec-030 shape: a
 *     `decision` block missing the (now-required) `action` field. The exact
 *     reject reason is derived from the real validator directly below,
 *     rather than hardcoded, so this test stays correct if the schema's
 *     error wording ever changes.
 */

import "obsidian";
import { App, WorkspaceLeaf } from "obsidian";
import { describe, expect, it } from "vitest";

import { ObsidianGardenAuditDoc } from "../../src/garden-audit/ObsidianGardenAuditDoc.js";
import { validate } from "../../src/schema/garden-audit-validator.js";
import type { GardenAuditWire } from "../../src/types/garden-audit.js";
import { GardenAuditEditorView } from "../../src/ui/garden-audit-view/GardenAuditEditorView.js";
import { FakeVaultFS } from "../../src/vault/FakeVaultFS.js";
import currentWireFixture from "../fixtures/garden-audit/current-wire.json";
import staleWireFixture from "../fixtures/garden-audit/stale-pre030-wire.json";

const DOC_PATH = "100 Inbox/run-editor-001_garden-audit.json";
// F01's affected note (dead_link context extraction, T6.1) — seeded with real
// content so the extractor resolves cleanly rather than degrading to
// "note-not-found", per the task brief's async-ordering note.
const DEAD_LINK_NOTE_PATH = "Notes/Src.md";
const DEAD_LINK_NOTE_CONTENT = "# Notes\n\nSee [[Missing Note]] for background.\n";

const fixture = currentWireFixture as unknown as GardenAuditWire;

/** Waits enough microtask ticks for a fire-and-forget async handler (Save's
 * `void this.handleSave()`, the dead-link context promise chain) to settle —
 * mirrors GardenAuditEditorView.test.ts's `flushAsyncHandler`. */
async function flushAsyncHandler(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function seededVault(): Promise<FakeVaultFS> {
	const vault = new FakeVaultFS();
	await vault.create(DOC_PATH, JSON.stringify(fixture, null, 2) + "\n");
	await vault.create(DEAD_LINK_NOTE_PATH, DEAD_LINK_NOTE_CONTENT);
	return vault;
}

/** Builds and opens the real view over the real adapter — the one stack this
 * whole suite exercises. */
async function openView(vault: FakeVaultFS): Promise<GardenAuditEditorView> {
	const adapter = new ObsidianGardenAuditDoc(vault);
	const leaf = new WorkspaceLeaf();
	const view = new GardenAuditEditorView(leaf, { adapter, docPath: DOC_PATH, vault });
	view.app = new App();
	// Dead-link context's stale-completion guard checks `placeholder.isConnected`
	// — attach to a live document so the async resolution actually lands
	// (mirrors GardenAuditEditorView.test.ts's dead-link-cache describe block).
	document.body.appendChild(view.contentEl);
	await view.onOpen();
	await flushAsyncHandler();
	return view;
}

function findingRow(view: GardenAuditEditorView, id: string): HTMLElement {
	const row = view.contentEl.querySelector(`.hashi-ga-finding-row[data-finding-id="${id}"]`);
	if (row === null) throw new Error(`no finding row for ${id}`);
	return row as HTMLElement;
}

function targetInput(row: HTMLElement): HTMLInputElement {
	const input = row.querySelector(".hashi-ga-target-inp");
	if (input === null) throw new Error("no target input in row");
	return input as HTMLInputElement;
}

function suggestToggle(row: HTMLElement): HTMLInputElement {
	const toggle = row.querySelector(".hashi-ga-suggest-toggle");
	if (toggle === null) throw new Error("no suggest toggle in row");
	return toggle as HTMLInputElement;
}

/** Commits a free-typed target value the same way a real user would: set the
 * input's value, then fire the `change` event `TargetControl` listens for. */
function setTarget(row: HTMLElement, value: string): void {
	const input = targetInput(row);
	input.value = value;
	input.dispatchEvent(new Event("change"));
}

function toggleSuggest(row: HTMLElement, checked: boolean): void {
	const toggle = suggestToggle(row);
	toggle.checked = checked;
	toggle.dispatchEvent(new Event("change"));
}

function saveButton(view: GardenAuditEditorView): HTMLButtonElement {
	const actions = view.contentEl.querySelector(".hashi-se-leaf-actions");
	const btn = Array.from(actions?.querySelectorAll("button") ?? []).find(
		(b) => b.textContent === "Save",
	);
	if (btn === undefined) throw new Error("no Save button");
	return btn as HTMLButtonElement;
}

async function clickSave(view: GardenAuditEditorView): Promise<void> {
	saveButton(view).click();
	await flushAsyncHandler();
}

async function readWritten(vault: FakeVaultFS): Promise<GardenAuditWire> {
	return JSON.parse(await vault.read(DOC_PATH)) as GardenAuditWire;
}

function findFinding(doc: GardenAuditWire, id: string) {
	const finding = doc.findings.find((f) => f.id === id);
	if (finding === undefined) throw new Error(`no finding ${id} in written doc`);
	return finding;
}

describe("Garden-Audit Editor end-to-end — real view + real adapter + real validator over FakeVaultFS", () => {
	it("opens the current-shape fixture and renders all three tier sections with the fixture's finding counts", async () => {
		const vault = await seededVault();
		const view = await openView(vault);

		const sections = view.contentEl.querySelectorAll(".hashi-ga-tier");
		expect(sections).toHaveLength(3);

		const [integrity, structure, advisory] = Array.from(sections);
		// Integrity: F01 (dead_link) + F02 (broken_up), both fixable and
		// already decision.selected:true in the fixture → "2 of 2".
		expect(integrity?.querySelector(".hashi-ga-tier-count")?.textContent).toBe("2 of 2");
		// Structure: F03 (orphan) + F04 (unparented), same shape → "2 of 2".
		expect(structure?.querySelector(".hashi-ga-tier-count")?.textContent).toBe("2 of 2");
		// Advisory: F09 (stale_moc) — never fixable, so the plain count.
		expect(advisory?.querySelector(".hashi-ga-tier-count")?.textContent).toBe("1");

		document.body.removeChild(view.contentEl);
	});

	it("edits one target per fixable check type, saves through the real Save button, and writes the decisions + approved:true + emit_digest byte-identical", async () => {
		const vault = await seededVault();
		const view = await openView(vault);

		// One distinct, real DOM edit per fixable check type (F01 dead_link,
		// F02 broken_up, F03 orphan, F04 unparented) — driven through the actual
		// TargetControl input + change event, not the underlying transform.
		setTarget(findingRow(view, "F01"), "Anchor Note");
		setTarget(findingRow(view, "F02"), "New Parent MOC");
		setTarget(findingRow(view, "F03"), "100 Filing MOC");
		setTarget(findingRow(view, "F04"), "200 Filing MOC");

		expect(saveButton(view).disabled).toBe(false);
		await clickSave(view);

		const written = await readWritten(vault);

		// --- per-check apply field lands ---
		expect(findFinding(written, "F01").decision?.replace).toBe("Anchor Note");
		expect(findFinding(written, "F02").decision?.repoint).toBe("New Parent MOC");
		expect(findFinding(written, "F03").decision?.file_under).toBe("100 Filing MOC");
		expect(findFinding(written, "F04").decision?.file_under).toBe("200 Filing MOC");

		// --- ADR-5: a non-empty repoint always derives add_relationship ---
		expect(findFinding(written, "F02").decision?.action).toBe("add_relationship");

		// --- whole-run approve gate + opaque digest passthrough ---
		expect(written.approved).toBe(true);
		expect(written.emit_digest).toBe(fixture.emit_digest);

		// --- whole-doc verbatim guard (PRD F10 "own the whole document"): every
		// field NOT edited survives byte-identical, including detail, the other
		// decision sub-fields, top-level passthrough metadata, and the
		// untouched advisory finding. ---
		expect(written.schema_version).toBe(fixture.schema_version);
		expect(written.generated).toBe(fixture.generated);
		expect(written.run_id).toBe(fixture.run_id);
		expect(written.profile).toBe(fixture.profile);

		for (const id of ["F01", "F02", "F03", "F04"]) {
			const originalFinding = findFinding(fixture, id);
			const writtenFinding = findFinding(written, id);
			expect(writtenFinding.target).toEqual(originalFinding.target);
			expect(writtenFinding.detail).toEqual(originalFinding.detail);
			expect(writtenFinding.decision?.selected).toBe(originalFinding.decision?.selected);
			expect(writtenFinding.decision?.candidates).toEqual(originalFinding.decision?.candidates);
			expect(writtenFinding.decision?.suggest_requested).toBe(
				originalFinding.decision?.suggest_requested,
			);
		}

		const writtenAdvisory = findFinding(written, "F09");
		expect(writtenAdvisory).toEqual(findFinding(fixture, "F09"));

		document.body.removeChild(view.contentEl);
	});

	it("a Suggest-only edit saves suggest_requested alone — every apply-decision field and emit_digest stay byte-identical", async () => {
		const vault = await seededVault();
		const view = await openView(vault);

		// Touch ONLY the "Suggest targets" toggle on one finding — no target
		// field, no Apply/Skip toggle.
		toggleSuggest(findingRow(view, "F01"), true);

		expect(saveButton(view).disabled).toBe(false);
		await clickSave(view);

		const written = await readWritten(vault);

		expect(findFinding(written, "F01").decision?.suggest_requested).toBe(true);
		// 2026-07-24 suggest_pending gate: F01 now has suggest_requested:true
		// with no `suggested` marker yet — a pending suggest — so Save PARKS
		// the run instead of approving it (transforms.applyApprovalGate).
		expect(written.approved).toBe(false);
		expect(written.suggest_pending).toBe(true);
		expect(written.emit_digest).toBe(fixture.emit_digest);

		// Every apply-decision field, on EVERY finding, is byte-equal to the
		// input — a Suggest-only edit changes no apply-field anywhere.
		for (const originalFinding of fixture.findings) {
			if (originalFinding.decision === undefined) continue;
			const writtenFinding = findFinding(written, originalFinding.id);
			expect(writtenFinding.decision?.selected).toBe(originalFinding.decision.selected);
			expect(writtenFinding.decision?.replace).toBe(originalFinding.decision.replace);
			expect(writtenFinding.decision?.repoint).toBe(originalFinding.decision.repoint);
			expect(writtenFinding.decision?.file_under).toBe(originalFinding.decision.file_under);
		}
		// suggest_requested is unchanged on every OTHER finding.
		for (const originalFinding of fixture.findings) {
			if (originalFinding.id === "F01" || originalFinding.decision === undefined) continue;
			const writtenFinding = findFinding(written, originalFinding.id);
			expect(writtenFinding.decision?.suggest_requested).toBe(
				originalFinding.decision.suggest_requested,
			);
		}

		document.body.removeChild(view.contentEl);
	});

	it("a stale pre-030 wire (validator reject) opens into the error surface with no editable state", async () => {
		// Derive the expected reject reason from the REAL validator, rather than
		// hardcoding a guess — schema-driven per the task brief.
		const validation = validate(staleWireFixture);
		expect(validation.ok).toBe(false);
		if (validation.ok) return;

		const vault = new FakeVaultFS();
		await vault.create(DOC_PATH, JSON.stringify(staleWireFixture, null, 2) + "\n");
		const view = await openView(vault);

		expect(view.contentEl.textContent).toContain(
			`Couldn't load garden audit: ObsidianGardenAuditDoc.load(${DOC_PATH}): ${validation.message}`,
		);

		// No editable state at all: no leaf-head/Save chrome, no cards.
		expect(view.contentEl.querySelector(".hashi-se-leaf-actions")).toBeNull();
		expect(view.contentEl.querySelector(".hashi-ga-card")).toBeNull();
		expect(
			Array.from(view.contentEl.querySelectorAll("button")).find((b) => b.textContent === "Save"),
		).toBeUndefined();

		document.body.removeChild(view.contentEl);
	});
});
