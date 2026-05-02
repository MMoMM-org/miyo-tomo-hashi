/**
 * Modal listing every running Tomo container, one row per instance, with
 * label (instance name or shortId fallback) and uptime via formatUptime.
 * Selecting a row asks TomoConnection to attach to that container and
 * dismisses the modal; the connection lifecycle (attaching → connected /
 * disconnected) is reflected by the SettingsTab subscription separately.
 *
 * Spec: docs/XDD/specs/001-session-view —
 *   - PRD F1 (discover instances), F2 (connect/disconnect)
 *   - SDD "Directory Map" entry for `src/settings/InstancePickerModal.ts`
 *
 * Failure surface:
 *   - openPicker() rejecting with ConnectionFailure → render `.detail`
 *     inline inside the modal so the user sees the cause without bouncing
 *     to a Notice.
 *   - openPicker() resolving to [] → friendly empty-state message
 *     (matches the `no-instances` ConnectionError detail copy verbatim).
 */

import { type App, Modal } from "obsidian";

import { ConnectionFailure } from "../connection/docker";
import type { TomoConnection } from "../connection/TomoConnection";
import type { TomoInstance } from "../connection/types";
import { formatUptime } from "../ui/util/time";

const EMPTY_STATE_MESSAGE =
	"No Tomo instance seems to be running — start one and try again.";

export class InstancePickerModal extends Modal {
	constructor(
		app: App,
		private readonly connection: TomoConnection,
	) {
		super(app);
	}

	override async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("hashi-instance-picker");
		// M13 (review/spec-001): use Obsidian's titleEl so the dialog
		// container's aria-labelledby chain wires up automatically.
		// Pre-fix used `contentEl.createEl("h2", ...)` which bypassed
		// titleEl entirely; the dialog's computed accessible name was
		// empty depending on Obsidian's internal labeling.
		this.titleEl.setText("Tomo instance");

		const listEl = contentEl.createDiv({ cls: "hashi-instance-picker-list" });
		// H6: announce async state transitions to assistive tech. The
		// loading→list / loading→empty / loading→error swaps happen via
		// listEl.empty() + new child append; without aria-live they are
		// silent in screen readers. polite + atomic rebuilds the announcement
		// each time the contents change.
		listEl.setAttr("aria-live", "polite");
		listEl.setAttr("aria-atomic", "true");
		listEl.createDiv({
			cls: "hashi-instance-picker-loading",
			text: "Loading…",
		});

		let instances: TomoInstance[];
		try {
			instances = await this.connection.openPicker();
		} catch (err: unknown) {
			listEl.empty();
			const message =
				err instanceof ConnectionFailure
					? err.detail
					: "Failed to list Tomo instances.";
			listEl.createDiv({
				cls: "hashi-instance-picker-error",
				text: message,
			});
			return;
		}

		listEl.empty();

		if (instances.length === 0) {
			listEl.createDiv({
				cls: "hashi-instance-picker-empty",
				text: EMPTY_STATE_MESSAGE,
			});
			return;
		}

		for (const instance of instances) {
			const row = listEl.createEl("button", {
				cls: "hashi-instance-picker-row",
			});
			const label = instance.name ?? instance.shortId;
			const uptime = formatUptime(instance.startedAt);
			row.setText(`${label} — started ${uptime}`);
			row.addEventListener("click", () => {
				this.close();
				void this.connection.connect(instance);
			});
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
