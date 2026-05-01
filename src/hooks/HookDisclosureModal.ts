/**
 * HookDisclosureModal — ask-mode disclosure UI for HookRunner.
 *
 * Phase 4 wired `HookRunner` to receive an injected `askCallback` of shape
 * `(absolutePath: string) => Promise<AskDecision>`. This modal IS that
 * callback's UI realisation: it shows the user the hook path + size and a
 * brief capability disclosure (PRD F8 trust model), then resolves with the
 * three-way decision.
 *
 * Lifecycle:
 *   - Construct with `(app, hookInfo)`. `present()` calls `Modal.open()` and
 *     returns a Promise that resolves on the first user signal (button click
 *     or Esc).
 *   - Esc resolves to `"disable"` — defensive default per PRD F8.
 *   - The Promise resolves exactly once. Subsequent button clicks after a
 *     resolution are no-ops (the resolver is nulled after first fire).
 *   - Each instance owns its own Promise; constructing a fresh modal yields a
 *     fresh, independent resolution.
 *
 * Decision-name mapping note: PRD F8 button labels are "Enable" / "Enable
 * once" / "Disable", but the underlying `AskDecision` values
 * `"enable-session" | "enable-once" | "disable"` come from `HookRunner`. The
 * "Enable" button maps to `"enable-session"` (remembered for the session, per
 * F8 line 171) — no label-translation layer between the modal and the
 * runner. Logged as deviation 2026-04-29 (T5.3).
 *
 * [ref: PRD/F8; SDD HookDisclosureModal; phase-5 T5.3]
 */

import { type App, Modal } from "obsidian";

import type { AskDecision } from "./HookRunner";

export interface HookInfo {
	/** Vault-relative path to the hook file (e.g., `.tomo-hashi/hooks/before-create_moc.js`). */
	readonly vaultRelativePath: string;
	/** Hook file size in bytes. */
	readonly fileSizeBytes: number;
}

const DISCLOSURE_TEXT =
	"This hook will run with full plugin privileges: vault access, " +
	"Node filesystem and network, shell execution, and environment " +
	"variables. Only enable hooks from sources you trust.";

export class HookDisclosureModal extends Modal {
	private resolver: ((decision: AskDecision) => void) | null = null;
	private readonly escHandler: (evt: KeyboardEvent) => void;

	constructor(
		app: App,
		private readonly hookInfo: HookInfo,
	) {
		super(app);
		this.escHandler = (evt: KeyboardEvent) => {
			if (evt.key !== "Escape") return;
			this.resolveOnce("disable");
		};
	}

	/**
	 * Opens the modal and returns a Promise that resolves exactly once on the
	 * user's first decision (button click or Esc).
	 */
	present(): Promise<AskDecision> {
		const promise = new Promise<AskDecision>((resolve) => {
			this.resolver = resolve;
		});
		this.open();
		return promise;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("hashi-hook-disclosure-modal");
		contentEl.addEventListener("keydown", this.escHandler);

		const filename = this.deriveFilename(this.hookInfo.vaultRelativePath);

		contentEl.createEl("h2", {
			cls: "hashi-hook-disclosure-modal-title",
			text: filename,
		});

		const meta = contentEl.createDiv({ cls: "hashi-hook-disclosure-modal-meta" });
		meta.createEl("div", {
			cls: "hashi-hook-disclosure-modal-path",
			text: this.hookInfo.vaultRelativePath,
		});
		meta.createEl("div", {
			cls: "hashi-hook-disclosure-modal-size",
			text: `${this.hookInfo.fileSizeBytes} B`,
		});

		contentEl.createEl("p", {
			cls: "hashi-hook-disclosure-modal-disclosure",
			text: DISCLOSURE_TEXT,
		});

		const buttons = contentEl.createDiv({
			cls: "hashi-hook-disclosure-modal-buttons",
		});
		this.createButton(buttons, "Enable", "enable-session", true);
		this.createButton(buttons, "Enable once", "enable-once", false);
		this.createButton(buttons, "Disable", "disable", false);
	}

	override onClose(): void {
		this.contentEl.removeEventListener("keydown", this.escHandler);
		this.contentEl.empty();
		// If the modal was closed by means other than a tracked signal (e.g.,
		// the user clicked the close-X chrome), default to disable so any
		// awaiting caller still gets a resolution.
		this.resolveOnce("disable");
	}

	private createButton(
		parent: HTMLElement,
		label: string,
		decision: AskDecision,
		isPrimary: boolean,
	): HTMLButtonElement {
		const btn = parent.createEl("button", { text: label });
		if (isPrimary) btn.addClass("mod-cta");
		btn.addEventListener("click", () => {
			this.resolveOnce(decision);
		});
		return btn;
	}

	private resolveOnce(decision: AskDecision): void {
		if (this.resolver === null) return;
		const resolve = this.resolver;
		this.resolver = null;
		resolve(decision);
	}

	private deriveFilename(vaultRelativePath: string): string {
		const idx = vaultRelativePath.lastIndexOf("/");
		return idx === -1
			? vaultRelativePath
			: vaultRelativePath.slice(idx + 1);
	}
}
