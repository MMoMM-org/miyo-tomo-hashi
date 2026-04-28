/**
 * Unit tests for SettingsTab + InstancePickerModal — Phase-4 T4.1 Settings
 * pane Connect/Disconnect + open picker.
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

import { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectionStore } from "../../../../src/connection/connectionStore";
import { ConnectionFailure } from "../../../../src/connection/docker";
import type { ConnectionState } from "../../../../src/connection/state";
import type { TomoConnection } from "../../../../src/connection/TomoConnection";
import type { TomoInstance } from "../../../../src/connection/types";
import type TomoHashiPlugin from "../../../../src/main";
import { InstancePickerModal } from "../../../../src/settings/InstancePickerModal";
import { SettingsTab } from "../../../../src/settings/SettingsTab";

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

// Minimal plugin stub — SettingsTab only uses it as the second `super()` arg
// and reads no fields off it directly. The cast funnel mirrors `asConnection`
// — narrow shape now, full TomoHashiPlugin in Phase-5 wire-up.
interface PluginStub {
	settings: { chosenInstanceId: string | null };
}

function makePlugin(): PluginStub {
	return { settings: { chosenInstanceId: null } };
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
