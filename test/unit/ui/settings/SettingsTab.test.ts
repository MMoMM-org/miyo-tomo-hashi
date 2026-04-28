/**
 * Unit tests for SettingsTab + InstancePickerModal — Phase-4 T4.1 Settings
 * pane Connect/Disconnect + open picker; and T1.3 Instruction Executor
 * settings (6 new fields + UI controls).
 *
 * Approach: TomoConnection is stubbed at the test-double level — we don't
 * mock the whole class, we instantiate a small object that satisfies the
 * subset of the surface the SettingsTab + Modal actually call (state,
 * disconnect, openPicker, connect). This keeps tests focused on the UI
 * wiring without re-exercising connection mechanics.
 *
 * The obsidian mock has been extended with HTMLElement DOM helpers
 * (createDiv / createEl / empty / addClass / setText) so production code
 * can use idiomatic Obsidian style.
 */

import { App, Notice } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectionStore } from "../../../../src/connection/connectionStore";
import { ConnectionFailure } from "../../../../src/connection/docker";
import type { ConnectionState } from "../../../../src/connection/state";
import type { TomoConnection } from "../../../../src/connection/TomoConnection";
import type { TomoInstance } from "../../../../src/connection/types";
import type TomoHashiPlugin from "../../../../src/main";
import { InstancePickerModal } from "../../../../src/settings/InstancePickerModal";
import { SettingsTab } from "../../../../src/settings/SettingsTab";
import { DEFAULT_SETTINGS } from "../../../../src/types/index";
import type { PluginSettings } from "../../../../src/types/index";

// --- factories ---------------------------------------------------------------

let _instCounter = 0;
const inst = (overrides: Partial<TomoInstance> = {}): TomoInstance => {
	_instCounter += 1;
	const seed = `abcdef${_instCounter.toString().padStart(6, "0")}`;
	const containerId = seed.padEnd(64, "0");
	return {
		containerId,
		shortId: containerId.slice(0, 12),
		name: "test-instance",
		startedAt: new Date("2026-04-28T11:55:00Z"),
		image: "miyo/tomo:0.7.0",
		...overrides,
	};
};

interface FakeConnection {
	state: ConnectionState;
	openPicker: ReturnType<typeof vi.fn>;
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
}

function makeConnection(
	overrides: Partial<FakeConnection> = {},
): FakeConnection {
	return {
		state: { kind: "disconnected" },
		openPicker: vi.fn<() => Promise<TomoInstance[]>>(async () => []),
		connect: vi.fn<(target: TomoInstance) => Promise<void>>(async () => {}),
		disconnect: vi.fn<() => Promise<void>>(async () => {}),
		...overrides,
	};
}

function asConnection(fake: FakeConnection): TomoConnection {
	// Test double: only the surface the SettingsTab/Modal actually touches is
	// implemented. The real class is heavier than the UI needs.
	return fake as unknown as TomoConnection;
}

// Minimal plugin stub — SettingsTab only uses it as the second `super()` arg,
// reads plugin.settings, and calls plugin.saveSettings() when controls change.
// Extended in T1.3 to include all PluginSettings fields + saveSettings().
interface PluginStub {
	settings: PluginSettings;
	saveSettings: ReturnType<typeof vi.fn>;
}

function makePlugin(overrides: Partial<PluginSettings> = {}): PluginStub {
	return {
		settings: { ...DEFAULT_SETTINGS, ...overrides },
		saveSettings: vi.fn<() => Promise<void>>(async () => {}),
	};
}

function asPlugin(stub: PluginStub): TomoHashiPlugin {
	return stub as unknown as TomoHashiPlugin;
}

// --- shared setup ------------------------------------------------------------

beforeEach(() => {
	connectionStore.set({ kind: "disconnected" });
});

afterEach(() => {
	connectionStore.set({ kind: "disconnected" });
});

// --- SettingsTab -------------------------------------------------------------

describe("SettingsTab", () => {
	it("renders Connect button when state is Disconnected", () => {
		connectionStore.set({ kind: "disconnected" });
		const conn = makeConnection({ state: { kind: "disconnected" } });
		const app = new App();
		const plugin = makePlugin();
		const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

		tab.display();

		const btn = tab.containerEl.querySelector(".hashi-settings-connect");
		expect(btn).not.toBeNull();
		expect(btn?.textContent).toContain("Connect");
		expect(
			tab.containerEl.querySelector(".hashi-settings-disconnect"),
		).toBeNull();
	});

	it("renders Disconnect button + instance name when connected", () => {
		const target = inst({ name: "alpha" });
		connectionStore.set({ kind: "connected", instance: target });
		const conn = makeConnection({
			state: { kind: "connected", instance: target },
		});
		const app = new App();
		const plugin = makePlugin();
		const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

		tab.display();

		const btn = tab.containerEl.querySelector(".hashi-settings-disconnect");
		expect(btn).not.toBeNull();
		expect(btn?.textContent).toContain("Disconnect");
		expect(tab.containerEl.textContent).toContain("alpha");
	});

	it("clicking Connect opens an InstancePickerModal (open() invokes onOpen())", () => {
		connectionStore.set({ kind: "disconnected" });
		const conn = makeConnection({ state: { kind: "disconnected" } });
		const app = new App();
		const plugin = makePlugin();
		const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

		// In the obsidian mock, Modal.open() invokes the instance's onOpen()
		// (mirroring real Obsidian). Spy on the subclass onOpen so we can
		// assert the click → modal-construction → open() pipeline ran.
		const onOpenSpy = vi
			.spyOn(InstancePickerModal.prototype, "onOpen")
			.mockImplementation(async () => {
				/* no-op for unit test — we only need to confirm open() ran */
			});

		try {
			tab.display();
			const btn = tab.containerEl.querySelector(
				".hashi-settings-connect",
			) as HTMLButtonElement | null;
			expect(btn).not.toBeNull();
			btn?.click();

			expect(onOpenSpy).toHaveBeenCalledTimes(1);
		} finally {
			onOpenSpy.mockRestore();
		}
	});

	it("clicking Disconnect calls connection.disconnect()", () => {
		const target = inst({ name: "beta" });
		connectionStore.set({ kind: "connected", instance: target });
		const conn = makeConnection({
			state: { kind: "connected", instance: target },
		});
		const app = new App();
		const plugin = makePlugin();
		const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

		tab.display();
		const btn = tab.containerEl.querySelector(
			".hashi-settings-disconnect",
		) as HTMLButtonElement | null;
		btn?.click();

		expect(conn.disconnect).toHaveBeenCalledTimes(1);
	});

	it("DOM updates live when connectionStore.set fires", () => {
		connectionStore.set({ kind: "disconnected" });
		const conn = makeConnection({ state: { kind: "disconnected" } });
		const app = new App();
		const plugin = makePlugin();
		const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

		tab.display();
		expect(
			tab.containerEl.querySelector(".hashi-settings-connect"),
		).not.toBeNull();

		const target = inst({ name: "gamma" });
		connectionStore.set({ kind: "connected", instance: target });

		expect(
			tab.containerEl.querySelector(".hashi-settings-connect"),
		).toBeNull();
		expect(
			tab.containerEl.querySelector(".hashi-settings-disconnect"),
		).not.toBeNull();
		expect(tab.containerEl.textContent).toContain("gamma");
	});

	it("subscription is cleaned up on hide()", () => {
		const conn = makeConnection({ state: { kind: "disconnected" } });
		const app = new App();
		const plugin = makePlugin();
		const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

		// Test introspection of the singleton store's listener set — the only
		// sanctioned `as unknown as` use case (probing private state).
		const peek = (): number =>
			(connectionStore as unknown as { listeners: Set<unknown> }).listeners
				.size;

		const before = peek();
		tab.display();
		const during = peek();
		expect(during).toBe(before + 1);

		tab.hide();
		const after = peek();
		expect(after).toBe(before);
	});

	it("re-entering display() after hide() does not leak subscriptions", () => {
		const conn = makeConnection({ state: { kind: "disconnected" } });
		const app = new App();
		const plugin = makePlugin();
		const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

		const peek = (): number =>
			(connectionStore as unknown as { listeners: Set<unknown> }).listeners
				.size;
		const baseline = peek();

		tab.display();
		tab.display(); // hot-reload re-render — old sub must be cleaned up
		expect(peek()).toBe(baseline + 1);

		tab.hide();
		expect(peek()).toBe(baseline);
	});
});

// --- InstancePickerModal -----------------------------------------------------

describe("InstancePickerModal", () => {
	it("renders 'Loading…' before openPicker resolves", async () => {
		let release: (value: TomoInstance[]) => void = () => {};
		const pending = new Promise<TomoInstance[]>((resolve) => {
			release = resolve;
		});
		const conn = makeConnection({
			openPicker: vi.fn<() => Promise<TomoInstance[]>>(async () => pending),
		});
		const app = new App();
		const modal = new InstancePickerModal(app, asConnection(conn));

		const opening = modal.onOpen();
		expect(modal.contentEl.textContent).toContain("Loading");

		release([]);
		await opening;
	});

	it("renders one row per instance with name + uptime", async () => {
		const a = inst({ name: "alpha" });
		const b = inst({ name: "beta" });
		const conn = makeConnection({
			openPicker: vi.fn<() => Promise<TomoInstance[]>>(async () => [a, b]),
		});
		const app = new App();
		const modal = new InstancePickerModal(app, asConnection(conn));

		await modal.onOpen();

		const rows = modal.contentEl.querySelectorAll(
			".hashi-instance-picker-row",
		);
		expect(rows.length).toBe(2);
		expect(rows[0]?.textContent).toContain("alpha");
		expect(rows[0]?.textContent).toMatch(/ago/);
		expect(rows[1]?.textContent).toContain("beta");
	});

	it("falls back to shortId when instance.name is null", async () => {
		const anon = inst({ name: null, shortId: "deadbeef0001" });
		const conn = makeConnection({
			openPicker: vi.fn<() => Promise<TomoInstance[]>>(async () => [anon]),
		});
		const app = new App();
		const modal = new InstancePickerModal(app, asConnection(conn));

		await modal.onOpen();
		const row = modal.contentEl.querySelector(".hashi-instance-picker-row");
		expect(row?.textContent).toContain("deadbeef0001");
	});

	it("clicking a row calls connection.connect(instance) and closes modal", async () => {
		const target = inst({ name: "delta" });
		const conn = makeConnection({
			openPicker: vi.fn<() => Promise<TomoInstance[]>>(async () => [target]),
		});
		const app = new App();
		const modal = new InstancePickerModal(app, asConnection(conn));
		const closeSpy = vi.spyOn(modal, "close");

		await modal.onOpen();
		const row = modal.contentEl.querySelector(
			".hashi-instance-picker-row",
		) as HTMLButtonElement | null;
		row?.click();

		// `await` to let the async click handler resolve connection.connect
		await Promise.resolve();
		await Promise.resolve();

		expect(conn.connect).toHaveBeenCalledWith(target);
		expect(closeSpy).toHaveBeenCalledTimes(1);
	});

	it("renders empty-state message when picker returns []", async () => {
		const conn = makeConnection({
			openPicker: vi.fn<() => Promise<TomoInstance[]>>(async () => []),
		});
		const app = new App();
		const modal = new InstancePickerModal(app, asConnection(conn));

		await modal.onOpen();

		const empty = modal.contentEl.querySelector(
			".hashi-instance-picker-empty",
		);
		expect(empty).not.toBeNull();
		expect(empty?.textContent).toContain("No Tomo instance");
	});

	it("renders error inline when openPicker rejects with ConnectionFailure", async () => {
		const conn = makeConnection({
			openPicker: vi.fn<() => Promise<TomoInstance[]>>(async () => {
				throw new ConnectionFailure({
					code: "daemon-unreachable",
					detail: "Docker socket is not reachable.",
				});
			}),
		});
		const app = new App();
		const modal = new InstancePickerModal(app, asConnection(conn));

		await modal.onOpen();

		const err = modal.contentEl.querySelector(
			".hashi-instance-picker-error",
		);
		expect(err).not.toBeNull();
		expect(err?.textContent).toContain("Docker socket is not reachable");
	});
});

// --- T1.3: Instruction executor settings ------------------------------------
//
// Tests for the 6 new PluginSettings fields (tomoInboxFolder, executionMode,
// runLogRetention, hooksDir, hooksPolicy, debugLogging) and their UI controls
// in the "Instruction executor" section of SettingsTab.
//
// Test file location deviation: these tests are co-located in this file rather
// than `test/unit/settings/SettingsTab.test.ts` (as the plan draft listed) for
// codebase consistency — the existing 001 tests are here, and a second file for
// the same component would fragment coverage.
//
// onChange testing approach: the improved obsidian mock (addText / addToggle /
// addDropdown) captures the onChange handler passed in the callback and exposes
// it on the SettingsTab instance via `_handlers` map keyed by the setting name.
// This lets tests fire onChange without test hooks in production code.

describe("SettingsTab — instruction executor controls", () => {
	it("renders 'Instruction executor' heading", () => {
		const conn = makeConnection();
		const app = new App();
		const plugin = makePlugin();
		const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

		tab.display();

		// The heading setting has setName("Instruction executor") called.
		// The mock Setting appends a settingEl div; setName records the call.
		// The simplest assertion: the text content of containerEl contains the label.
		const text = tab.containerEl.textContent ?? "";
		expect(text).toContain("Instruction executor");
	});

	it("renders all 6 instruction executor controls by label", () => {
		const conn = makeConnection();
		const app = new App();
		const plugin = makePlugin();
		const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

		tab.display();

		const text = tab.containerEl.textContent ?? "";
		expect(text).toContain("Tomo inbox folder");
		expect(text).toContain("Execution mode");
		expect(text).toContain("Run log retention");
		expect(text).toContain("Hooks directory");
		expect(text).toContain("Hooks");
		expect(text).toContain("Debug logging");
	});

	it("changing tomoInboxFolder to a valid path calls saveSettings once", async () => {
		const conn = makeConnection();
		const app = new App();
		const plugin = makePlugin();
		const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

		tab.display();
		// Fire the onChange for tomoInboxFolder directly via the captured handler
		await tab._handlers.tomoInboxFolder?.("inbox/tomo");

		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.settings.tomoInboxFolder).toBe("inbox/tomo");
	});

	it("changing debugLogging toggle calls saveSettings once", async () => {
		const conn = makeConnection();
		const app = new App();
		const plugin = makePlugin();
		const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

		tab.display();
		await tab._handlers.debugLogging?.(true);

		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.settings.debugLogging).toBe(true);
	});

	it("changing executionMode dropdown calls saveSettings once", async () => {
		const conn = makeConnection();
		const app = new App();
		const plugin = makePlugin();
		const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

		tab.display();
		await tab._handlers.executionMode?.("auto-run");

		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.settings.executionMode).toBe("auto-run");
	});

	// ---- path-safety guard — tomoInboxFolder ----

	const unsafePaths = [
		{ path: "/foo", reason: "absolute path" },
		{ path: "\\foo", reason: "absolute path (backslash)" },
		{ path: "C:\\foo", reason: "Windows drive letter" },
		{ path: "D:foo", reason: "Windows drive letter" },
		{ path: "..", reason: "traversal" },
		{ path: "a/../b", reason: "traversal segment" },
		{ path: "a//b", reason: "empty segment" },
	];

	for (const { path, reason } of unsafePaths) {
		it(`tomoInboxFolder rejects unsafe path: ${reason} (${JSON.stringify(path)})`, async () => {
			const noticeSpy = vi.mocked(Notice);
			noticeSpy.mockClear();

			const conn = makeConnection();
			const app = new App();
			const plugin = makePlugin({ tomoInboxFolder: "safe/path" });
			const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

			tab.display();
			await tab._handlers.tomoInboxFolder?.(path);

			// saveSettings must NOT be called — rejection rolls back
			expect(plugin.saveSettings).not.toHaveBeenCalled();
			// value must revert to previous safe value
			expect(plugin.settings.tomoInboxFolder).toBe("safe/path");
			// Notice must have fired
			expect(noticeSpy).toHaveBeenCalled();
		});
	}

	it("tomoInboxFolder accepts empty string (default state)", async () => {
		const conn = makeConnection();
		const app = new App();
		const plugin = makePlugin({ tomoInboxFolder: "some/path" });
		const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

		tab.display();
		await tab._handlers.tomoInboxFolder?.("");

		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.settings.tomoInboxFolder).toBe("");
	});

	// ---- path-safety guard — hooksDir ----

	for (const { path, reason } of unsafePaths) {
		it(`hooksDir rejects unsafe path: ${reason} (${JSON.stringify(path)})`, async () => {
			const noticeSpy = vi.mocked(Notice);
			noticeSpy.mockClear();

			const conn = makeConnection();
			const app = new App();
			const plugin = makePlugin({ hooksDir: ".tomo-hashi/hooks" });
			const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

			tab.display();
			await tab._handlers.hooksDir?.(path);

			expect(plugin.saveSettings).not.toHaveBeenCalled();
			expect(plugin.settings.hooksDir).toBe(".tomo-hashi/hooks");
			expect(noticeSpy).toHaveBeenCalled();
		});
	}

	// ---- ask-mode contract: no extraneous fields in persisted settings ----
	//
	// PRD F11: ask-mode per-hook decisions live in memory only (HookRunner
	// runtime map) and NEVER appear in data.json. Phase 4 will add the full
	// reload-and-reprompt behavioral test once HookRunner exists. For T1.3
	// we assert that after plugin.saveSettings() is called, the object saved
	// contains exactly the expected union of 001 + 002 keys, no extras.
	//
	// Note: plugin.saveSettings() in the stub updates plugin.settings;
	// we assert the exact keys on that settings object.

	it("persisted settings contain exactly the expected keys — no hookAskDecisions or extras", async () => {
		const conn = makeConnection();
		const app = new App();
		const plugin = makePlugin();
		const tab = new SettingsTab(app, asPlugin(plugin), asConnection(conn));

		tab.display();
		// Trigger any save to exercise the path
		await tab._handlers.debugLogging?.(false);
		await Promise.resolve();

		const savedKeys = new Set(Object.keys(plugin.settings));
		const expectedKeys = new Set<string>([
			// 001 fields
			"chosenInstanceName",
			"zoomLevel",
			// 002 fields
			"tomoInboxFolder",
			"executionMode",
			"runLogRetention",
			"hooksDir",
			"hooksPolicy",
			"debugLogging",
		]);

		// No extra keys (e.g. hookAskDecisions) in persisted data
		for (const key of savedKeys) {
			expect(expectedKeys).toContain(key);
		}
		// All expected keys present
		for (const key of expectedKeys) {
			expect(savedKeys).toContain(key);
		}
	});

	// ---- defaults render correctly on a fresh PluginSettings ----

	it("default values are set on a fresh PluginSettings", () => {
		expect(DEFAULT_SETTINGS.tomoInboxFolder).toBe("");
		expect(DEFAULT_SETTINGS.executionMode).toBe("confirm");
		expect(DEFAULT_SETTINGS.runLogRetention).toBe("always");
		expect(DEFAULT_SETTINGS.hooksDir).toBe(".tomo-hashi/hooks");
		expect(DEFAULT_SETTINGS.hooksPolicy).toBe("ask");
		expect(DEFAULT_SETTINGS.debugLogging).toBe(false);
	});
});
