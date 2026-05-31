/**
 * ConfirmModal — destructive-action confirmation dialog.
 *
 * Spec refs: docs/XDD/specs/003-ide-bridge/plan/phase-4.md T4.2;
 *   SDD/Settings UI line 375 (Regenerate UX);
 *   SDD/User Interface & UX line 579 (Cancel focused by default).
 *
 * Behaviour under test:
 *   - renders title (h3) + message (p) + exactly two buttons (Cancel, Confirm)
 *   - Confirm carries the `mod-warning` CSS class
 *   - clicking Confirm invokes the async onConfirm spy AND closes the modal
 *   - clicking Cancel closes without invoking onConfirm
 *   - Cancel has default focus on open
 *   - onClose empties contentEl
 */

import "obsidian";
import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { ConfirmModal } from "../../../src/ui/ConfirmModal";

// --- factories --------------------------------------------------------------

function makeModal(onConfirm?: () => Promise<void>): ConfirmModal {
	const app = new App();
	const confirm = onConfirm ?? vi.fn<() => Promise<void>>(async () => {});
	return new ConfirmModal(app, "Test title", "Test message", confirm);
}

// ---------------------------------------------------------------------------

describe("ConfirmModal", () => {
	describe("onOpen — rendering", () => {
		it("renders the title as an h3 with the provided text", () => {
			const modal = makeModal();
			modal.onOpen();

			const heading = modal.contentEl.querySelector("h3");
			expect(heading).not.toBeNull();
			expect(heading?.textContent).toBe("Test title");
		});

		it("renders the message as a paragraph with the provided text", () => {
			const modal = makeModal();
			modal.onOpen();

			const paragraph = modal.contentEl.querySelector("p");
			expect(paragraph).not.toBeNull();
			expect(paragraph?.textContent).toBe("Test message");
		});

		it("renders exactly two buttons", () => {
			const modal = makeModal();
			modal.onOpen();

			const buttons = modal.contentEl.querySelectorAll("button");
			expect(buttons).toHaveLength(2);
		});

		it("first button is Cancel", () => {
			const modal = makeModal();
			modal.onOpen();

			const buttons = modal.contentEl.querySelectorAll("button");
			expect(buttons[0]?.textContent).toBe("Cancel");
		});

		it("second button is Confirm with mod-warning class", () => {
			const modal = makeModal();
			modal.onOpen();

			const buttons = modal.contentEl.querySelectorAll("button");
			expect(buttons[1]?.textContent).toBe("Confirm");
			expect(buttons[1]?.classList.contains("mod-warning")).toBe(true);
		});

		it("Cancel button has default focus after open", () => {
			const modal = makeModal();
			// focus() only takes effect when the element is attached to the document
			// (ExecutionModal test pattern: attach → open → assert → detach)
			document.body.appendChild(modal.contentEl);
			modal.onOpen();

			const cancelBtn = modal.contentEl.querySelectorAll("button")[0];
			expect(document.activeElement).toBe(cancelBtn);

			document.body.removeChild(modal.contentEl);
		});
	});

	describe("onOpen — Confirm click", () => {
		it("invokes the async onConfirm callback", async () => {
			const onConfirm = vi.fn<() => Promise<void>>(async () => {});
			const modal = new ConfirmModal(new App(), "Title", "Msg", onConfirm);
			modal.onOpen();

			const confirmBtn = modal.contentEl.querySelectorAll("button")[1] as HTMLButtonElement;
			confirmBtn.click();

			// Allow microtasks to settle so void Promise resolves
			await vi.waitFor(() => {
				expect(onConfirm).toHaveBeenCalledOnce();
			});
		});

		it("calls close() when Confirm is clicked", () => {
			const onConfirm = vi.fn<() => Promise<void>>(async () => {});
			const modal = new ConfirmModal(new App(), "Title", "Msg", onConfirm);
			modal.onOpen();

			const confirmBtn = modal.contentEl.querySelectorAll("button")[1] as HTMLButtonElement;
			confirmBtn.click();

			expect(modal.close).toHaveBeenCalledOnce();
		});
	});

	describe("onOpen — Cancel click", () => {
		it("calls close() when Cancel is clicked", () => {
			const onConfirm = vi.fn<() => Promise<void>>(async () => {});
			const modal = new ConfirmModal(new App(), "Title", "Msg", onConfirm);
			modal.onOpen();

			const cancelBtn = modal.contentEl.querySelectorAll("button")[0] as HTMLButtonElement;
			cancelBtn.click();

			expect(modal.close).toHaveBeenCalledOnce();
		});

		it("does NOT invoke onConfirm when Cancel is clicked", () => {
			const onConfirm = vi.fn<() => Promise<void>>(async () => {});
			const modal = new ConfirmModal(new App(), "Title", "Msg", onConfirm);
			modal.onOpen();

			const cancelBtn = modal.contentEl.querySelectorAll("button")[0] as HTMLButtonElement;
			cancelBtn.click();

			expect(onConfirm).not.toHaveBeenCalled();
		});
	});

	describe("onClose", () => {
		it("empties contentEl on close", () => {
			const modal = makeModal();
			modal.onOpen();

			expect(modal.contentEl.childElementCount).toBeGreaterThan(0);
			modal.onClose();
			expect(modal.contentEl.childElementCount).toBe(0);
		});
	});
});
