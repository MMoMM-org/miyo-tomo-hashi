/**
 * Reproduction + regression tests for the user-reported bug:
 * "Disabling/enabling the plugin regenerates the IDE-bridge auth token."
 *
 * The auth token (`ideBridgeAuthToken`, format `hashi_<UUID>`) MUST persist
 * across a plugin reload AND across enable/disable of the bridge. An explicit
 * Regenerate is the ONLY path that mints a new token.
 *
 * Strategy: model the real plugin lifecycle WITHOUT Obsidian. A `FakeDataStore`
 * stands in for data.json; `persist` mirrors main.ts's reassign-on-persist
 * semantics (writes a NEW settings object back to the store). A plugin "reload"
 * is modelled by constructing a NEW IdeBridge from the persisted settings — a
 * fresh instance starts with `this.token === ""`, exactly like after a reload.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — token.ts keep-or-mint rule,
 *       IdeBridge.ensurePersistedToken, SDD getter-vs-snapshot gotcha (685).
 */

import "obsidian";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeEditorAdapter } from "../../../src/ide-bridge/FakeEditorAdapter";
import { IdeBridge } from "../../../src/ide-bridge/IdeBridge";
import type { IdeBridgeDeps, WsServerLike } from "../../../src/ide-bridge/IdeBridge";
import { ideBridgeStore } from "../../../src/ide-bridge/ideBridgeStore";
import type { WsServerOptions } from "../../../src/ide-bridge/wsServer";
import { buildIdeBridgeHandlers, type SettingsPersistence } from "../../../src/settings/SettingsTab";
import type { SelectionTracker } from "../../../src/ide-bridge/selectionTracker";
import type { PluginSettings } from "../../../src/types";

type BridgeSettings = PluginSettings & {
	ideBridgePort: number;
	ideBridgeAuthToken: string;
};

function makeSettings(overrides: Partial<BridgeSettings> = {}): BridgeSettings {
	return {
		settings_version: 2,
		chosenInstanceName: null,
		zoomLevel: 1,
		tomoInboxFolder: "",
		executionMode: "confirm",
		runLogRetention: "always",
		hooksDir: ".tomo-hashi/hooks",
		hooksPolicy: "ask",
		debugLogging: false,
		ideBridgeEnabled: true,
		ideBridgePort: 23027,
		ideBridgeAuthToken: "",
		...overrides,
	} as BridgeSettings;
}

/** A trivial no-op WsServer that just records the port and the live token getter. */
class NoopWsServer implements WsServerLike {
	readonly opts: WsServerOptions;
	constructor(opts: WsServerOptions) {
		this.opts = opts;
	}
	async listen(): Promise<number> {
		return this.opts.port;
	}
	async stop(): Promise<void> {}
	broadcast(): void {}
	clientCount(): number {
		return 0;
	}
}

/**
 * A fake data store + main.ts-style host. `getSettings()` returns the live
 * object; `persist()` mirrors main.ts: it saves AND reassigns the live object
 * to the persisted (new) one. Constructing a fresh IdeBridge from `current()`
 * models a plugin reload (fresh in-memory token = "").
 */
function makeHost(initial: BridgeSettings) {
	let live = initial;
	const persist = vi.fn(async (next: PluginSettings): Promise<void> => {
		// Mirror main.ts: reassign the live settings to the NEW object.
		live = next as BridgeSettings;
	});
	const tracker = {
		onEditorActivity: vi.fn(),
		getLatest: vi.fn(() => null),
		dispose: vi.fn(),
	};
	const buildBridge = (): IdeBridge => {
		const deps: IdeBridgeDeps = {
			app: {} as IdeBridgeDeps["app"],
			version: "0.5.2",
			getSettings: () => live,
			persist,
			log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
			makeServer: (opts) => new NoopWsServer(opts),
			makeAdapter: () => new FakeEditorAdapter(),
			makeTracker: () => tracker as unknown as SelectionTracker,
		};
		return new IdeBridge(deps);
	};
	return {
		current: (): BridgeSettings => live,
		persist,
		buildBridge,
	};
}

describe("IDE bridge auth-token persistence across reload / enable-disable", () => {
	beforeEach(() => {
		ideBridgeStore.set({ kind: "stopped" });
	});
	afterEach(() => {
		ideBridgeStore.set({ kind: "stopped" });
		vi.restoreAllMocks();
	});

	it("enable → mint+persist; RELOAD with enabled bridge reuses the SAME token (no regeneration)", async () => {
		const host = makeHost(makeSettings({ ideBridgeAuthToken: "" }));

		// First session: enable the bridge → token minted + persisted.
		const first = host.buildBridge();
		await first.start();
		const t1 = first.getToken();
		expect(t1).toMatch(/^hashi_[0-9a-f-]{36}$/);
		expect(host.current().ideBridgeAuthToken).toBe(t1);

		// --- RELOAD: fresh IdeBridge from the persisted settings (token "" in memory).
		const reloaded = host.buildBridge();
		await reloaded.start();

		expect(reloaded.getToken()).toBe(t1); // reused — NOT a new token
		expect(host.current().ideBridgeAuthToken).toBe(t1); // data store untouched
	});

	it("RELOAD with DISABLED bridge: token is recoverable for the UI without calling start()", async () => {
		const t1 = "hashi_11111111-1111-4111-8111-111111111111";
		const host = makeHost(
			makeSettings({ ideBridgeAuthToken: t1, ideBridgeEnabled: false }),
		);

		// Reload, bridge disabled → start() is NOT called (mirrors main.ts:
		// `if (settings.ideBridgeEnabled) void start()`).
		const reloaded = host.buildBridge();

		// The settings UI calls getToken() at render time. It MUST surface the
		// persisted token even though start()/ensurePersistedToken never ran.
		expect(reloaded.getToken()).toBe(t1);
	});

	it("enable → disable → enable within ONE session preserves the token", async () => {
		const host = makeHost(makeSettings({ ideBridgeAuthToken: "" }));
		const bridge = host.buildBridge();

		await bridge.start();
		const t1 = bridge.getToken();
		expect(t1).toMatch(/^hashi_/);

		await bridge.stop();
		expect(bridge.getToken()).toBe(t1); // still the same after stop

		await bridge.start();
		expect(bridge.getToken()).toBe(t1); // re-enabled → same token
		expect(host.current().ideBridgeAuthToken).toBe(t1);
	});

	it("SettingsTab persistence path never clobbers ideBridgeAuthToken back to empty", async () => {
		// A persisted token exists; bridge starts (real ensurePersistedToken).
		const t1 = "hashi_22222222-2222-4222-8222-222222222222";
		const host = makeHost(makeSettings({ ideBridgeAuthToken: t1 }));
		const bridge = host.buildBridge();
		await bridge.start();
		expect(bridge.getToken()).toBe(t1);

		// Settings UI persistence mirrors main.ts: a live settings object + a save
		// that reassigns it. We toggle port + enable through the real handlers and
		// assert the token survives every save (object-identity divergence guard).
		const persistence: SettingsPersistence = {
			get settings(): PluginSettings {
				return host.current();
			},
			saveSettings: async () => {
				// Mirror main.ts saveSettings → saveData(this.settings). No reassign
				// here; the live object IS the settings. Persisting it should keep
				// the token that the bridge already minted into the same object.
				await host.persist(host.current());
			},
		};
		const handlers = buildIdeBridgeHandlers(bridge, persistence);

		await handlers.port("23055");
		expect(host.current().ideBridgeAuthToken).toBe(t1);

		await handlers.enable(false);
		expect(host.current().ideBridgeAuthToken).toBe(t1);

		await handlers.enable(true);
		expect(host.current().ideBridgeAuthToken).toBe(t1);
		expect(bridge.getToken()).toBe(t1);
	});

	it("the WsServer auth getter sees the persisted token after a disabled-then-enabled reload", async () => {
		// Regression for the robustness fix: getToken() falls back to persisted
		// settings, so even a server built before ensurePersistedToken ran would
		// authorize with the correct token.
		const t1 = "hashi_33333333-3333-4333-8333-333333333333";
		const host = makeHost(makeSettings({ ideBridgeAuthToken: t1 }));
		const reloaded = host.buildBridge();
		// Before start(): getToken() must already reflect the persisted token.
		expect(reloaded.getToken()).toBe(t1);
		await reloaded.start();
		expect(reloaded.getToken()).toBe(t1);
	});
});
