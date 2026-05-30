/**
 * Unit tests for openPopover — Phase-4 T4.2 status bar popover +
 * T4.4 IDE Bridge status line + Copy auth token action.
 *
 * Spec refs: spec 001-session-view phase-4 T4.2; PRD F3 (all ACs);
 * spec 003-ide-bridge phase-4 T4.4; SDD ADR-9,
 * "UI Visualization / Status bar icon".
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
	ideStatusLine: "IDE Bridge: stopped",
	ideRunning: false,
	onCopyToken: vi.fn(),
});

const disabledActions = () => ({
	forceReconnectEnabled: false,
	onForceReconnect: vi.fn(),
	onOpenChat: vi.fn(),
	onOpenSettings: vi.fn(),
	ideStatusLine: "IDE Bridge: stopped",
	ideRunning: false,
	onCopyToken: vi.fn(),
});

const runningActions = () => ({
	forceReconnectEnabled: true,
	onForceReconnect: vi.fn(),
	onOpenChat: vi.fn(),
	onOpenSettings: vi.fn(),
	ideStatusLine: "IDE Bridge: connected(1) :23027",
	ideRunning: true,
	onCopyToken: vi.fn(),
});

describe("openPopover", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates a Menu with exactly 4 items when bridge is stopped (IDE status + 3 actions)", () => {
		const menu = openPopover(new MouseEvent("click"), enabledActions()) as MenuWithItems;
		// IDE status (disabled info) + Open chat + Force reconnect + Go to settings
		expect(menu.addItem).toHaveBeenCalledTimes(4);
		expect(menu.items).toHaveLength(4);
	});

	it("creates a Menu with 5 items when bridge is running (IDE status + Copy token + 3 actions)", () => {
		const menu = openPopover(new MouseEvent("click"), runningActions()) as MenuWithItems;
		// IDE status info item + Copy auth token + 3 regular actions
		expect(menu.addItem).toHaveBeenCalledTimes(5);
		expect(menu.items).toHaveLength(5);
	});

	it("'Open chat window' item has message-square icon", () => {
		const menu = openPopover(new MouseEvent("click"), enabledActions()) as MenuWithItems;
		const item = menu.items.find((i) =>
			i.setTitle.mock.calls.some((args) => args[0] === "Open chat window")
		);
		expect(item).toBeDefined();
		expect(item!.setIcon).toHaveBeenCalledWith("message-square");
	});

	it("'Force reconnect' item has refresh-ccw icon", () => {
		const menu = openPopover(new MouseEvent("click"), enabledActions()) as MenuWithItems;
		const item = menu.items.find((i) =>
			i.setTitle.mock.calls.some((args) => (args[0] as string).includes("Force reconnect"))
		);
		expect(item).toBeDefined();
		expect(item!.setIcon).toHaveBeenCalledWith("refresh-ccw");
	});

	it("'Go to settings' item has settings icon", () => {
		const menu = openPopover(new MouseEvent("click"), enabledActions()) as MenuWithItems;
		const item = menu.items.find((i) =>
			i.setTitle.mock.calls.some((args) => args[0] === "Go to settings")
		);
		expect(item).toBeDefined();
		expect(item!.setIcon).toHaveBeenCalledWith("settings");
	});

	it("IDE status line item is rendered with the ideStatusLine text (disabled info item)", () => {
		const actions = runningActions();
		const menu = openPopover(new MouseEvent("click"), actions) as MenuWithItems;
		// IDE status line sits at item index 0 per SDD layout
		const ideItem = menu.items[0];
		expect(ideItem).toBeDefined();
		const titles = ideItem!.setTitle.mock.calls.map((args) => args[0] as string);
		expect(titles.some((t) => t.includes("IDE Bridge: connected(1) :23027"))).toBe(true);
		// It is a display-only item — must be disabled
		expect(ideItem!.setDisabled).toHaveBeenCalledWith(true);
	});

	it("IDE status line item is always rendered (even when bridge is stopped)", () => {
		// Per SDD popover layout, the IDE Bridge line is always shown.
		// Copy auth token is the only item gated on ideRunning.
		const actions = enabledActions(); // ideRunning: false
		const menu = openPopover(new MouseEvent("click"), actions) as MenuWithItems;
		const allTitles = menu.items.flatMap((item) =>
			item.setTitle.mock.calls.map((args) => args[0] as string)
		);
		expect(allTitles.some((t) => t.includes("IDE Bridge:"))).toBe(true);
	});

	it("'Copy auth token' item is shown when ideRunning is true", () => {
		const actions = runningActions();
		const menu = openPopover(new MouseEvent("click"), actions) as MenuWithItems;
		const allTitles = menu.items.flatMap((item) =>
			item.setTitle.mock.calls.map((args) => args[0] as string)
		);
		expect(allTitles.some((t) => t.toLowerCase().includes("copy auth token"))).toBe(true);
	});

	it("'Copy auth token' item is NOT shown when ideRunning is false (stopped)", () => {
		const actions = enabledActions(); // ideRunning: false
		const menu = openPopover(new MouseEvent("click"), actions) as MenuWithItems;
		const allTitles = menu.items.flatMap((item) =>
			item.setTitle.mock.calls.map((args) => args[0] as string)
		);
		expect(allTitles.some((t) => t.toLowerCase().includes("copy auth token"))).toBe(false);
	});

	it("'Copy auth token' item is NOT shown when ideRunning is false (error)", () => {
		const actions = {
			...enabledActions(),
			ideStatusLine: "IDE Bridge: error — port in use",
			ideRunning: false,
		};
		const menu = openPopover(new MouseEvent("click"), actions) as MenuWithItems;
		const allTitles = menu.items.flatMap((item) =>
			item.setTitle.mock.calls.map((args) => args[0] as string)
		);
		expect(allTitles.some((t) => t.toLowerCase().includes("copy auth token"))).toBe(false);
	});

	it("clicking 'Copy auth token' invokes onCopyToken", () => {
		const actions = runningActions();
		const menu = openPopover(new MouseEvent("click"), actions) as MenuWithItems;
		// Find the Copy auth token item by title
		const copyItem = menu.items.find((item) =>
			item.setTitle.mock.calls.some((args) =>
				(args[0] as string).toLowerCase().includes("copy auth token")
			)
		);
		expect(copyItem).toBeDefined();
		const handler = copyItem!.onClick.mock.calls[0]?.[0] as (() => void) | undefined;
		expect(handler).toBeTypeOf("function");
		handler!();
		expect(actions.onCopyToken).toHaveBeenCalledTimes(1);
	});

	it("'Open chat window' click invokes onOpenChat", () => {
		const actions = enabledActions();
		const menu = openPopover(new MouseEvent("click"), actions) as MenuWithItems;
		const chatItem = menu.items.find((item) =>
			item.setTitle.mock.calls.some((args) => args[0] === "Open chat window")
		);
		expect(chatItem).toBeDefined();
		const handler = chatItem!.onClick.mock.calls[0]?.[0] as (() => void) | undefined;
		expect(handler).toBeTypeOf("function");
		handler!();
		expect(actions.onOpenChat).toHaveBeenCalledTimes(1);
		expect(actions.onForceReconnect).not.toHaveBeenCalled();
		expect(actions.onOpenSettings).not.toHaveBeenCalled();
	});

	it("'Force reconnect' click invokes onForceReconnect", () => {
		const actions = enabledActions();
		const menu = openPopover(new MouseEvent("click"), actions) as MenuWithItems;
		const reconnectItem = menu.items.find((item) =>
			item.setTitle.mock.calls.some((args) =>
				(args[0] as string).includes("Force reconnect")
			)
		);
		expect(reconnectItem).toBeDefined();
		const handler = reconnectItem!.onClick.mock.calls[0]?.[0] as (() => void) | undefined;
		expect(handler).toBeTypeOf("function");
		handler!();
		expect(actions.onForceReconnect).toHaveBeenCalledTimes(1);
		expect(actions.onOpenChat).not.toHaveBeenCalled();
		expect(actions.onOpenSettings).not.toHaveBeenCalled();
	});

	it("'Go to settings' click invokes onOpenSettings", () => {
		const actions = enabledActions();
		const menu = openPopover(new MouseEvent("click"), actions) as MenuWithItems;
		const settingsItem = menu.items.find((item) =>
			item.setTitle.mock.calls.some((args) => args[0] === "Go to settings")
		);
		expect(settingsItem).toBeDefined();
		const handler = settingsItem!.onClick.mock.calls[0]?.[0] as (() => void) | undefined;
		expect(handler).toBeTypeOf("function");
		handler!();
		expect(actions.onOpenSettings).toHaveBeenCalledTimes(1);
		expect(actions.onForceReconnect).not.toHaveBeenCalled();
		expect(actions.onOpenChat).not.toHaveBeenCalled();
	});

	it("disables 'Force reconnect' when forceReconnectEnabled is false", () => {
		const menu = openPopover(new MouseEvent("click"), disabledActions()) as MenuWithItems;
		const reconnectItem = menu.items.find((item) =>
			item.setTitle.mock.calls.some((args) =>
				(args[0] as string).includes("Force reconnect")
			)
		);
		expect(reconnectItem).toBeDefined();
		expect(reconnectItem!.setDisabled).toHaveBeenCalledWith(true);
	});

	it("disabled 'Force reconnect' carries an explanatory title (no instance chosen)", () => {
		const menu = openPopover(new MouseEvent("click"), disabledActions()) as MenuWithItems;
		const reconnectItem = menu.items.find((item) =>
			item.setTitle.mock.calls.some((args) =>
				(args[0] as string).includes("Force reconnect")
			)
		);
		expect(reconnectItem).toBeDefined();
		const titles = reconnectItem!.setTitle.mock.calls.map((args) => args[0] as string);
		expect(titles.some((t) => t.toLowerCase().includes("no instance"))).toBe(true);
	});

	it("does not disable 'Force reconnect' when forceReconnectEnabled is true", () => {
		const menu = openPopover(new MouseEvent("click"), enabledActions()) as MenuWithItems;
		const reconnectItem = menu.items.find((item) =>
			item.setTitle.mock.calls.some((args) =>
				(args[0] as string).includes("Force reconnect")
			)
		);
		expect(reconnectItem).toBeDefined();
		const calledWithTrue = reconnectItem!.setDisabled.mock.calls.some(
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
		expect(actions.onCopyToken).not.toHaveBeenCalled();
	});
});
