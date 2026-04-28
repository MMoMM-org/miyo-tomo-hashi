/**
 * Status bar popover — pure builder that constructs an Obsidian Menu with the
 * three actions defined by the SDD's "UI Visualization / Status bar icon"
 * section and PRD F3/AC4: Force Reconnect, Open Chat Window, Go to Settings.
 *
 * Decoupled from the StatusBarIcon view: callers wire concrete behavior via
 * the `actions` parameter so the popover can be reused (and tested) without
 * pulling in the connection store, plugin instance, or workspace.
 *
 * Spec refs: spec 001-session-view phase-4 T4.2; PRD F3 (all ACs);
 * SDD ADR-9, "UI Visualization / Status bar icon".
 */

import { Menu } from "obsidian";

export interface PopoverActions {
	/**
	 * `true` when the user has chosen an instance (and a Force Reconnect
	 * action is meaningful). When `false`, the menu item is disabled and
	 * its title is amended to explain the reason.
	 */
	forceReconnectEnabled: boolean;
	onForceReconnect: () => void;
	onOpenChat: () => void;
	onOpenSettings: () => void;
}

export function openPopover(evt: MouseEvent, actions: PopoverActions): Menu {
	const menu = new Menu();

	// UI text uses Obsidian sentence-case (enforced by obsidianmd/ui/sentence-case).
	// The spec drafts these as Title-Case but Obsidian's community style guide
	// — which the eslint plugin codifies — is sentence-case.
	menu.addItem((item) => {
		item.setTitle("Force reconnect").setIcon("refresh-ccw");
		if (!actions.forceReconnectEnabled) {
			item.setDisabled(true);
			item.setTitle("Force reconnect (no instance chosen)");
		}
		item.onClick(() => {
			actions.onForceReconnect();
		});
	});

	menu.addItem((item) => {
		item.setTitle("Open chat window").setIcon("message-square");
		item.onClick(() => {
			actions.onOpenChat();
		});
	});

	menu.addItem((item) => {
		item.setTitle("Go to settings").setIcon("settings");
		item.onClick(() => {
			actions.onOpenSettings();
		});
	});

	menu.showAtMouseEvent(evt);
	return menu;
}
