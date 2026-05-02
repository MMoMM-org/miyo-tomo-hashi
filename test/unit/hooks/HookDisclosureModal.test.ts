/**
 * HookDisclosureModal — ask-mode disclosure UI driven by HookRunner's
 * `askCallback`.
 *
 * Spec refs: docs/XDD/specs/002-instruction-executor/plan/phase-5.md T5.3;
 *   PRD F8 (ask-mode disclosure: Enable / Enable once / Disable, capability
 *   trust model); SDD HookDisclosureModal directory entry.
 *
 * Behaviour under test:
 *   - Constructor takes `(app, hookInfo)` where `hookInfo` carries the
 *     vault-relative path and the file size in bytes.
 *   - `present()` returns a Promise<AskDecision> that resolves on:
 *       * Enable button       → "enable-session"
 *       * Enable once button  → "enable-once"
 *       * Disable button      → "disable"
 *       * Esc key             → "disable" (defensive default)
 *   - The Promise resolves exactly once. Subsequent button clicks after a
 *     resolution must not re-resolve.
 *   - The modal carries no state across instances: a fresh `HookDisclosureModal`
 *     has its own Promise that resolves independently.
 *   - The DOM shows the vault-relative path, the file size in bytes, and the
 *     three buttons in the order Enable / Enable once / Disable.
 *
 * Decision-name mapping note: PRD F8 button labels are "Enable", "Enable
 * once", "Disable" but the underlying decision values match HookRunner's
 * `AskDecision = "enable-session" | "enable-once" | "disable"` so Phase 6
 * wiring is mechanical (no label translation layer between the modal and the
 * runner). Logged as deviation 2026-04-29 (T5.3).
 */

import { App, Modal } from "obsidian";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HookDisclosureModal } from "../../../src/hooks/HookDisclosureModal";
import type { AskDecision } from "../../../src/hooks/HookRunner";

// --- helpers ----------------------------------------------------------------

interface HookInfoFixture {
	vaultRelativePath: string;
	fileSizeBytes: number;
}

function fixture(overrides: Partial<HookInfoFixture> = {}): HookInfoFixture {
	return {
		vaultRelativePath: ".tomo-hashi/hooks/before-create_moc.js",
		fileSizeBytes: 1234,
		...overrides,
	};
}

function findButton(
	modal: HookDisclosureModal,
	label: string,
): HTMLButtonElement | undefined {
	return Array.from(modal.contentEl.querySelectorAll("button")).find(
		(b) => b.textContent === label,
	);
}

function fireEsc(modal: HookDisclosureModal): void {
	const evt = new KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true,
		cancelable: true,
	});
	modal.contentEl.dispatchEvent(evt);
}

// --- tests ------------------------------------------------------------------

describe("HookDisclosureModal — sanity", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	afterEach(() => {
		// nothing global to tear down
	});

	it("is an Obsidian Modal subclass", () => {
		const modal = new HookDisclosureModal(app, fixture());
		expect(modal).toBeInstanceOf(Modal);
	});

	it("present() returns a Promise", () => {
		const modal = new HookDisclosureModal(app, fixture());
		const p = modal.present();
		expect(p).toBeInstanceOf(Promise);
		// Resolve it so the test doesn't leak an open handle.
		findButton(modal, "Disable")?.click();
		return p;
	});
});

describe("HookDisclosureModal — DOM rendering", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it("renders the vault-relative hook path in the body", async () => {
		const modal = new HookDisclosureModal(
			app,
			fixture({ vaultRelativePath: ".tomo-hashi/hooks/after-move_note.js" }),
		);
		const decision = modal.present();

		expect(modal.contentEl.textContent).toContain(
			".tomo-hashi/hooks/after-move_note.js",
		);

		findButton(modal, "Disable")?.click();
		await decision;
	});

	it("renders the file size in bytes in the body", async () => {
		const modal = new HookDisclosureModal(
			app,
			fixture({ fileSizeBytes: 4096 }),
		);
		const decision = modal.present();

		expect(modal.contentEl.textContent).toMatch(/4096\s*B/);

		findButton(modal, "Disable")?.click();
		await decision;
	});

	it("renders three buttons in order: Disable, Enable once, Enable", async () => {
		// C1 (review/spec-002-fixes): Disable comes first so reflexive
		// keyboard Enter on the focused primary button cancels rather than
		// session-enables.
		const modal = new HookDisclosureModal(app, fixture());
		const decision = modal.present();

		const buttons = modal.contentEl.querySelectorAll("button");
		const labels = Array.from(buttons).map((b) => b.textContent ?? "");
		expect(labels).toEqual(["Disable", "Enable once", "Enable"]);

		findButton(modal, "Disable")?.click();
		await decision;
	});
});

describe("HookDisclosureModal — safe defaults (C1, C2)", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	// C1
	it("Disable is the primary (mod-cta) action", async () => {
		const modal = new HookDisclosureModal(app, fixture());
		const decision = modal.present();
		const disable = findButton(modal, "Disable");
		const enable = findButton(modal, "Enable");
		expect(disable?.classList.contains("mod-cta")).toBe(true);
		expect(enable?.classList.contains("mod-cta")).toBe(false);
		findButton(modal, "Disable")?.click();
		await decision;
	});

	// C1 — focus assertion requires contentEl attached to document
	it("Disable receives focus after open", async () => {
		const modal = new HookDisclosureModal(app, fixture());
		document.body.appendChild(modal.contentEl);
		try {
			const decision = modal.present();
			const disable = findButton(modal, "Disable");
			expect(document.activeElement).toBe(disable);
			findButton(modal, "Disable")?.click();
			await decision;
		} finally {
			document.body.removeChild(modal.contentEl);
		}
	});

	// C2
	it("contentEl exposes an accessible name via aria-labelledby", async () => {
		const modal = new HookDisclosureModal(app, fixture());
		const decision = modal.present();

		const labelledBy = modal.contentEl.getAttribute("aria-labelledby");
		expect(labelledBy).toBeTruthy();

		const heading = modal.contentEl.querySelector(
			`[id="${labelledBy}"]`,
		);
		expect(heading).not.toBeNull();
		// The accessible name must be a meaningful prompt — not just the
		// bare filename. Filename appears in the meta div separately.
		expect(heading?.textContent ?? "").toMatch(/enable hook/i);

		findButton(modal, "Disable")?.click();
		await decision;
	});

	// C2 — id collision check when two modals are open simultaneously
	it("two simultaneously-open modals have distinct labelledby ids", async () => {
		const a = new HookDisclosureModal(
			app,
			fixture({ vaultRelativePath: "hooks/a.js" }),
		);
		const b = new HookDisclosureModal(
			app,
			fixture({ vaultRelativePath: "hooks/b.js" }),
		);
		const pa = a.present();
		const pb = b.present();

		const idA = a.contentEl.getAttribute("aria-labelledby");
		const idB = b.contentEl.getAttribute("aria-labelledby");
		expect(idA).toBeTruthy();
		expect(idB).toBeTruthy();
		expect(idA).not.toBe(idB);

		findButton(a, "Disable")?.click();
		findButton(b, "Disable")?.click();
		await Promise.all([pa, pb]);
	});
});

describe("HookDisclosureModal — button → decision mapping", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it("Enable resolves to enable-session", async () => {
		const modal = new HookDisclosureModal(app, fixture());
		const decision = modal.present();
		findButton(modal, "Enable")?.click();
		const result: AskDecision = await decision;
		expect(result).toBe("enable-session");
	});

	it("Enable once resolves to enable-once", async () => {
		const modal = new HookDisclosureModal(app, fixture());
		const decision = modal.present();
		findButton(modal, "Enable once")?.click();
		const result: AskDecision = await decision;
		expect(result).toBe("enable-once");
	});

	it("Disable resolves to disable", async () => {
		const modal = new HookDisclosureModal(app, fixture());
		const decision = modal.present();
		findButton(modal, "Disable")?.click();
		const result: AskDecision = await decision;
		expect(result).toBe("disable");
	});
});

describe("HookDisclosureModal — Esc key (defensive default)", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it("Esc resolves to disable", async () => {
		const modal = new HookDisclosureModal(app, fixture());
		const decision = modal.present();
		fireEsc(modal);
		const result: AskDecision = await decision;
		expect(result).toBe("disable");
	});
});

describe("HookDisclosureModal — single-resolution", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it("resolves exactly once even if multiple buttons are clicked", async () => {
		const modal = new HookDisclosureModal(app, fixture());
		const decision = modal.present();

		findButton(modal, "Enable")?.click();
		// Subsequent clicks should not change the resolved value.
		findButton(modal, "Disable")?.click();
		findButton(modal, "Enable once")?.click();

		const result: AskDecision = await decision;
		expect(result).toBe("enable-session");
	});

	it("Esc after a button click does not re-resolve", async () => {
		const modal = new HookDisclosureModal(app, fixture());
		const decision = modal.present();

		findButton(modal, "Enable once")?.click();
		fireEsc(modal);

		const result: AskDecision = await decision;
		expect(result).toBe("enable-once");
	});
});

describe("HookDisclosureModal — no shared state across instances", () => {
	let app: App;

	beforeEach(() => {
		app = new App();
	});

	it("two instances each resolve their own Promise independently", async () => {
		const a = new HookDisclosureModal(
			app,
			fixture({ vaultRelativePath: "hooks/a.js" }),
		);
		const b = new HookDisclosureModal(
			app,
			fixture({ vaultRelativePath: "hooks/b.js" }),
		);

		const pa = a.present();
		const pb = b.present();

		findButton(a, "Enable")?.click();
		findButton(b, "Disable")?.click();

		const [da, db] = await Promise.all([pa, pb]);
		expect(da).toBe("enable-session");
		expect(db).toBe("disable");
	});

	it("re-instantiating after a previous resolution starts fresh", async () => {
		const first = new HookDisclosureModal(app, fixture());
		const firstDecision = first.present();
		findButton(first, "Enable")?.click();
		expect(await firstDecision).toBe("enable-session");

		// A new instance must not be pre-resolved by the first instance's state.
		const second = new HookDisclosureModal(app, fixture());
		const secondDecision = second.present();

		// Has not resolved yet — assert by racing against a microtask sentinel.
		const sentinel = Symbol("pending");
		const winner = await Promise.race([
			secondDecision,
			Promise.resolve(sentinel),
		]);
		expect(winner).toBe(sentinel);

		findButton(second, "Disable")?.click();
		expect(await secondDecision).toBe("disable");
	});
});
