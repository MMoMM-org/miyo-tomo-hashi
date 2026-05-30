/**
 * IdeBridge — the IDE Bridge lifecycle orchestrator and the SOLE writer of
 * `ideBridgeStore` (ADR-3 single-writer discipline).
 *
 * WHY this file exists: the transport (WsServer, T3.1), the token helpers
 * (token.ts), the selection tracker (T2.6), and the tool registry (Phase 2) are
 * each pure, Obsidian-free, and unaware of one another. Something has to own the
 * order of operations — ensure the token, build the adapter/tracker/registry,
 * start/stop the server, and translate the server's two state callbacks
 * (`onClientCountChange`, `onListenError`) into the `IdeBridgeState` machine.
 * That owner is this class. It is the ONLY place `ideBridgeStore.set()` is
 * called, so the store has exactly one writer and the rest of the system reads.
 *
 * No vault filesystem I/O. No lock file (the discovery lock is Tomo-generated
 * inside the container — ADR-8 superseded; SDD gotcha "No lock file in Hashi").
 *
 * Testability seam: the WsServer, EditorAdapter, and SelectionTracker are built
 * through injectable factories (`makeServer` / `makeAdapter` / `makeTracker`).
 * Production defaults construct the real implementations from `app`; unit tests
 * inject fakes and drive the server callbacks directly.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD lines 294-298 (state machine),
 *       323-339 (orchestrator API), PRD F3 (token regen).
 */

import type { App } from "obsidian";

import { ideBridgeStore } from "./ideBridgeStore";
import {
	ObsidianEditorAdapter,
	type EditorAdapter,
} from "./ObsidianEditorAdapter";
import {
	createSelectionTracker,
	type SelectionChangedNotification,
	type SelectionTracker,
} from "./selectionTracker";
import { ensureToken, generateToken } from "./token";
import { buildHandlerRegistry, buildToolsList } from "./tools/index";
import { WsServer, type WsServerOptions } from "./wsServer";

import type { PluginSettings } from "../types";

/** Default IDE Bridge port when settings do not (yet) carry the field. */
const DEFAULT_PORT = 23027;

/**
 * The subset of WsServer's public surface IdeBridge depends on. Declaring it
 * here lets unit tests inject a fake without a live TCP server, and documents
 * exactly which transport methods the orchestrator uses.
 */
export interface WsServerLike {
	listen(): Promise<number>;
	stop(): Promise<void>;
	broadcast(obj: unknown): void;
	clientCount(): number;
}

/**
 * The ideBridge* fields land on PluginSettings in Phase 4 (T4.1/T4.2). Until
 * then they may be absent on the persisted shape, so the orchestrator reads
 * them through this widened view with sensible fallbacks (port 23027, token "").
 * Do NOT couple IdeBridge to the post-T4 type — read defensively.
 */
type IdeBridgeSettings = PluginSettings & {
	ideBridgePort?: number;
	ideBridgeAuthToken?: string;
};

/** Constructor dependencies. Factories are optional — production defaults below. */
export interface IdeBridgeDeps {
	app: App;
	/** Plugin manifest version (e.g. "0.5.2") — threaded into serverInfo.version
	 * so the MCP initialize response always carries it. Claude Code's Zod
	 * validator requires serverInfo.version to be a string. */
	version: string;
	getSettings: () => PluginSettings;
	persist: (next: PluginSettings) => Promise<void>;
	log: {
		debug: (...args: unknown[]) => void;
		warn: (...args: unknown[]) => void;
		error: (...args: unknown[]) => void;
	};
	/** Build the transport. Defaults to the real WsServer. */
	makeServer?: (opts: WsServerOptions) => WsServerLike;
	/** Build the editor adapter. Defaults to the real ObsidianEditorAdapter. */
	makeAdapter?: (app: App) => EditorAdapter;
	/** Build the selection tracker. Defaults to the real createSelectionTracker. */
	makeTracker?: (
		adapter: EditorAdapter,
		broadcast: (msg: SelectionChangedNotification) => void,
	) => SelectionTracker;
}

export class IdeBridge {
	private readonly deps: IdeBridgeDeps;
	private token = "";
	private server: WsServerLike | null = null;
	private tracker: SelectionTracker | null = null;
	private port = DEFAULT_PORT;
	/** Guards against concurrent/overlapping start() calls (idempotency). */
	private starting = false;

	constructor(deps: IdeBridgeDeps) {
		this.deps = deps;
	}

	/**
	 * Start the bridge. Idempotent: a second call while running (or starting) is
	 * a no-op. Ensures the token (persisting a freshly minted one), builds the
	 * adapter/tracker/registry, listens, and sets the store to `listening`.
	 * A listen failure routes through `transitionError` → store `error`.
	 */
	async start(): Promise<void> {
		if (this.server !== null || this.starting) return;
		this.starting = true;
		try {
			await this.ensurePersistedToken();
			const settings = this.settings();
			this.port = settings.ideBridgePort ?? DEFAULT_PORT;

			const adapter = this.makeAdapter(this.deps.app);
			const tracker = this.makeTracker(adapter, (msg) => this.server?.broadcast(msg));
			this.tracker = tracker;

			const registry = buildHandlerRegistry(adapter, {
				getLatest: () => tracker.getLatest(),
			});

			const server = this.makeServer({
				port: this.port,
				getToken: () => this.token,
				registry,
				toolsList: buildToolsList(),
				serverInfo: { name: "miyo-tomo-hashi", version: this.deps.version },
				onClientCountChange: (n) => this.transitionClientCount(n),
				onListenError: (reason) => this.transitionError(reason),
				log: this.deps.log,
			});
			this.server = server;

			try {
				const boundPort = await server.listen();
				this.port = boundPort;
				this.transitionClientCount(server.clientCount());
			} catch (err) {
				// onListenError (if the server fired it) has already set error state;
				// otherwise record the rejection reason. Tear the half-built server down.
				this.server = null;
				this.tracker = null;
				tracker.dispose();
				if (ideBridgeStore.get().kind !== "error") {
					this.transitionError(err instanceof Error ? err.message : String(err));
				}
			}
		} finally {
			this.starting = false;
		}
	}

	/**
	 * Stop the bridge. Idempotent: a no-op when already stopped. Closes all
	 * clients then the server (via WsServer.stop), disposes the tracker timer,
	 * and sets the store to `stopped`.
	 */
	async stop(): Promise<void> {
		const server = this.server;
		if (server === null) return;
		this.server = null;
		await server.stop();
		this.tracker?.dispose();
		this.tracker = null;
		ideBridgeStore.set({ kind: "stopped" });
	}

	/** Single source of truth for the settings UI (Kado pattern). */
	isRunning(): boolean {
		return this.server !== null;
	}

	/**
	 * Rotate the bearer token (PRD F3). Mints a new `hashi_<UUID>`, persists it,
	 * and — when running — drops current clients by restarting the server so the
	 * old token stops authorizing (the new token is picked up via the live
	 * getter). Writes NO lock file and performs no vault filesystem I/O.
	 */
	async regenerateToken(): Promise<void> {
		this.token = generateToken();
		await this.persistToken(this.token);
		if (this.server !== null) {
			// Drop clients by cycling the server; the next listen() picks up the
			// new token through getToken() automatically.
			await this.stop();
			await this.start();
		}
	}

	/** Current bearer token (for the settings "Copy" action). */
	getToken(): string {
		return this.token;
	}

	/**
	 * Forward editor activity to the selection tracker. T4.5 wires the CM6
	 * updateListener and active-leaf-change events to call this; the actual
	 * register*() wiring is intentionally NOT done here (deferred to T4.5).
	 */
	onEditorActivity(): void {
		this.tracker?.onEditorActivity();
	}

	// -----------------------------------------------------------------------
	// Store transitions — the ONLY place ideBridgeStore.set() is called (ADR-3)
	// -----------------------------------------------------------------------

	private transitionClientCount(count: number): void {
		if (this.server === null) return; // ignore late callbacks after stop()
		if (count >= 1) {
			ideBridgeStore.set({ kind: "connected", port: this.port, clientCount: count });
		} else {
			ideBridgeStore.set({ kind: "listening", port: this.port });
		}
	}

	private transitionError(reason: string): void {
		ideBridgeStore.set({ kind: "error", reason });
	}

	// -----------------------------------------------------------------------
	// Token persistence
	// -----------------------------------------------------------------------

	/**
	 * Lazily initialise the token on first start, persisting only if freshly
	 * minted here. An in-memory token already set this session (e.g. by
	 * regenerateToken, which has already persisted it) wins over the persisted
	 * value and is NOT re-persisted, so a restart never double-writes.
	 */
	private async ensurePersistedToken(): Promise<void> {
		if (this.token) return; // already held in memory (and persisted) this session
		const persisted = this.settings().ideBridgeAuthToken ?? "";
		const next = ensureToken(persisted);
		this.token = next;
		if (next !== persisted) {
			await this.persistToken(next);
		}
	}

	/** Persist `token` into settings via the injected persist callback. */
	private async persistToken(token: string): Promise<void> {
		const next: IdeBridgeSettings = { ...this.settings(), ideBridgeAuthToken: token };
		await this.deps.persist(next);
	}

	// -----------------------------------------------------------------------
	// Factory + settings helpers
	// -----------------------------------------------------------------------

	private settings(): IdeBridgeSettings {
		return this.deps.getSettings();
	}

	private makeServer(opts: WsServerOptions): WsServerLike {
		return (this.deps.makeServer ?? ((o) => new WsServer(o)))(opts);
	}

	private makeAdapter(app: App): EditorAdapter {
		return (this.deps.makeAdapter ?? ((a) => new ObsidianEditorAdapter(a)))(app);
	}

	private makeTracker(
		adapter: EditorAdapter,
		broadcast: (msg: SelectionChangedNotification) => void,
	): SelectionTracker {
		return (this.deps.makeTracker ?? ((a, b) => createSelectionTracker(a, b)))(
			adapter,
			broadcast,
		);
	}
}
