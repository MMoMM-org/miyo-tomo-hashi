/**
 * ConfirmModal — minimal confirm/cancel dialog for destructive actions.
 *
 * Used by the IDE bridge settings section to gate the token-regenerate action
 * (T4.3). Title, message, and the async callback are injected by the caller —
 * this component is generic and reusable across any destructive confirm flow.
 *
 * Cancel is the default-focused button (accessibility, SDD line 579).
 * Confirm carries `mod-warning` to signal the destructive intent.
 *
 * [ref: SDD/Settings UI line 375; SDD/User Interface & UX line 579; phase-4 T4.2]
 */

import { type App, Modal } from "obsidian";

export class ConfirmModal extends Modal {
	private readonly title: string;
	private readonly message: string;
	private readonly onConfirm: () => Promise<void>;

	constructor(
		app: App,
		title: string,
		message: string,
		onConfirm: () => Promise<void>,
	) {
		super(app);
		this.title = title;
		this.message = message;
		this.onConfirm = onConfirm;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.title });
		contentEl.createEl("p", { text: this.message });

		const btnRow = contentEl.createDiv({ cls: "hashi-confirm-buttons" });

		const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => {
			this.close();
		});

		const confirmBtn = btnRow.createEl("button", {
			text: "Confirm",
			cls: "mod-warning",
		});
		confirmBtn.addEventListener("click", () => {
			void this.onConfirm();
			this.close();
		});

		cancelBtn.focus();
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
