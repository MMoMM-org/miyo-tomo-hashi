/**
 * Unit tests for openPopover — Phase-4 T4.2 status bar popover.
 *
 * Spec refs: spec 001-session-view phase-4 T4.2; PRD F3 (all ACs);
 * SDD ADR-9, "UI Visualization / Status bar icon".
 *
 * The Menu mock from `test/__mocks__/obsidian.ts` (T1.5, extended in T4.2)
 * captures every item-builder it created in a per-instance `items` array so
 * tests can introspect the calls to setTitle / setIcon / setDisabled /
 * onClick after the popover has been built.
 */

import { Menu } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { openPopover } from "../../../../src/ui/status-bar/openPopover";

interface MenuItemSpy {
	setTitle: ReturnType<typeof vi.fn>;
	setIcon: ReturnType<typeof vi.fn>;
	setDisabled: ReturnType<typeof vi.fn>;
	onClick: ReturnType<typeof vi.fn>;
}

interface MenuWithItems extends Menu {
	items: MenuItemSpy[];
}

const enabledActions = () => ({
	forceReconnectEnabled: true,
	onForceReconnect: vi.fn(),
	onOpenChat: vi.fn(),
	onOpenSettings: vi.fn(),
});

const disabledActions = () => ({
	forceReconnectEnabled: false,
	onForceReconnect: vi.fn(),
	onOpenChat: vi.fn(),
	onOpenSettings: vi.fn(),
});

describe("openPopover", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates a Menu with exactly 3 items", () => {
		const menu = openPopover(new MouseEvent("click"), enabledActions()) as MenuWithItems;
		expect(menu.addItem).toHaveBeenCalledTimes(3);
		expect(menu.items).toHaveLength(3);
	});

	it("first item is 'Open chat window' with message-square icon", () => {
		const menu = openPopover(new MouseEvent("click"), enabledActions()) as MenuWithItems;
		const item = menu.items[0];
		expect(item).toBeDefined();
		expect(item!.setTitle).toHaveBeenCalledWith("Open chat window");
		expect(item!.setIcon).toHaveBeenCalledWith("message-square");
	});

	it("second item is 'Force reconnect' with refresh-ccw icon", () => {
		const menu = openPopover(new MouseEvent("click"), enabledActions()) as MenuWithItems;
		const item = menu.items[1];
		expect(item).toBeDefined();
		expect(item!.setTitle).toHaveBeenCalledWith("Force reconnect");
		expect(item!.setIcon).toHaveBeenCalledWith("refresh-ccw");
	});

	it("third item is 'Go to settings' with settings icon", () => {
		const menu = openPopover(new MouseEvent("click"), enabledActions()) as MenuWithItems;
		const item = menu.items[2];
		expect(item).toBeDefined();
		expect(item!.setTitle).toHaveBeenCalledWith("Go to settings");
		expect(item!.setIcon).toHaveBeenCalledWith("settings");
	});

	it("'Open chat window' click invokes onOpenChat", () => {
		const actions = enabledActions();
		const menu = openPopover(new MouseEvent("click"), actions) as MenuWithItems;
		const item = menu.items[0];
		expect(item).toBeDefined();
		const handler = item!.onClick.mock.calls[0]?.[0] as (() => void) | undefined;
		expect(handler).toBeTypeOf("function");
		handler!();
		expect(actions.onOpenChat).toHaveBeenCalledTimes(1);
		expect(actions.onForceReconnect).not.toHaveBeenCalled();
		expect(actions.onOpenSettings).not.toHaveBeenCalled();
	});

	it("'Force reconnect' click invokes onForceReconnect", () => {
		const actions = enabledActions();
		const menu = openPopover(new MouseEvent("click"), actions) as MenuWithItems;
		const item = menu.items[1];
		expect(item).toBeDefined();
		const handler = item!.onClick.mock.calls[0]?.[0] as (() => void) | undefined;
		expect(handler).toBeTypeOf("function");
		handler!();
		expect(actions.onForceReconnect).toHaveBeenCalledTimes(1);
		expect(actions.onOpenChat).not.toHaveBeenCalled();
		expect(actions.onOpenSettings).not.toHaveBeenCalled();
	});

	it("'Go to settings' click invokes onOpenSettings", () => {
		const actions = enabledActions();
		const menu = openPopover(new MouseEvent("click"), actions) as MenuWithItems;
		const item = menu.items[2];
		expect(item).toBeDefined();
		const handler = item!.onClick.mock.calls[0]?.[0] as (() => void) | undefined;
		expect(handler).toBeTypeOf("function");
		handler!();
		expect(actions.onOpenSettings).toHaveBeenCalledTimes(1);
		expect(actions.onForceReconnect).not.toHaveBeenCalled();
		expect(actions.onOpenChat).not.toHaveBeenCalled();
	});

	it("disables 'Force reconnect' when forceReconnectEnabled is false", () => {
		const menu = openPopover(new MouseEvent("click"), disabledActions()) as MenuWithItems;
		const item = menu.items[1];
		expect(item).toBeDefined();
		expect(item!.setDisabled).toHaveBeenCalledWith(true);
	});

	it("disabled 'Force reconnect' carries an explanatory title (no instance chosen)", () => {
		const menu = openPopover(new MouseEvent("click"), disabledActions()) as MenuWithItems;
		const item = menu.items[1];
		expect(item).toBeDefined();
		const titles = item!.setTitle.mock.calls.map((args) => args[0] as string);
		expect(titles.some((t) => t.toLowerCase().includes("no instance"))).toBe(true);
	});

	it("does not disable 'Force reconnect' when forceReconnectEnabled is true", () => {
		const menu = openPopover(new MouseEvent("click"), enabledActions()) as MenuWithItems;
		const item = menu.items[1];
		expect(item).toBeDefined();
		const calledWithTrue = item!.setDisabled.mock.calls.some(
			(args) => args[0] === true,
		);
		expect(calledWithTrue).toBe(false);
	});

	it("calls Menu.showAtMouseEvent with the provided event", () => {
		const evt = new MouseEvent("click", { clientX: 42, clientY: 21 });
		const menu = openPopover(evt, enabledActions());
		expect(menu.showAtMouseEvent).toHaveBeenCalledTimes(1);
		expect(menu.showAtMouseEvent).toHaveBeenCalledWith(evt);
	});

	it("does not invoke any action callback during construction", () => {
		const actions = enabledActions();
		openPopover(new MouseEvent("click"), actions);
		expect(actions.onForceReconnect).not.toHaveBeenCalled();
		expect(actions.onOpenChat).not.toHaveBeenCalled();
		expect(actions.onOpenSettings).not.toHaveBeenCalled();
	});
});
