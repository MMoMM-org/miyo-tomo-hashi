/**
 * Command registry — Hashi's two palette commands:
 *   1. Reconnect to <instance-name>  (dynamic label, never opens the picker)
 *   2. Show chat window
 *
 * Spec refs: spec 001-session-view phase-5 T5.1; PRD F6 (dynamic-label
 * Reconnect command), PRD F7 (Show chat window command); SDD ADR-8
 * (removeCommand + addCommand on state change) and "Implementation
 * Examples / Dynamic Command Label".
 *
 * --- Decisions ---
 *
 * 1. The Reconnect label is computed from `connectionStore` via
 *    `displayInstanceName(state)` (a plain function per ADR-4 v3 — NOT a
 *    derived store). The SDD code sketch's old `displayInstanceName.subscribe`
 *    form is drift; subscribe to `connectionStore` and compute inline.
 *
 * 2. `removeCommand` + `addCommand` is the only way to "rename" a registered
 *    command in Obsidian. We dedupe by tracking the last-installed label;
 *    state changes that don't flip the visible name are no-ops.
 *
 * 3. `connection` is typed as `Pick<TomoConnection, "forceReconnect">` so
 *    tests can pass a structural stub without `as unknown as` ceremony.
 *    Production passes the full `TomoConnection` — assignment-compatible.
 *
 * 4. Only the subscription cleanup needs `plugin.register()` — Obsidian
 *    tears down both `addCommand` registrations automatically on unload.
 *    See SDD ADR-8 + comment in solution.md note block.
 *
 * 5. The PRD F6/AC5 Notice text is verbatim:
 *    "No Tomo instance chosen — open Settings → Connect."
 *    (em dash, full stop). Do not paraphrase — tests assert string equality.
 */

import type { Plugin } from "obsidian";
import { Notice } from "obsidian";

import {
	connectionStore,
	displayInstanceName,
} from "../connection/connectionStore";
import type { TomoConnection } from "../connection/TomoConnection";
import type {
	InstructionExecutor,
	Invocation,
} from "../executor/InstructionExecutor";
import type { IdeBridge } from "../ide-bridge/IdeBridge";
import { ideBridgeStore } from "../ide-bridge/ideBridgeStore";
import type { VaultFS } from "../vault/VaultFS";
import type { PluginSettings } from "../types/index";

const RECONNECT_ID = "reconnect-to-tomo";
const SHOW_CHAT_ID = "show-chat-window";

const NO_INSTANCE_NOTICE =
	"No Tomo instance chosen — open Settings → Connect.";

export interface CommandDeps {
	/**
	 * Narrow surface of `TomoConnection` — only `forceReconnect()` is needed
	 * here. Tests pass a `vi.fn`-bag that satisfies this shape; production
	 * passes the full connection.
	 */
	connection: Pick<TomoConnection, "forceReconnect">;
	/** Singleton chat-view opener. Wired in T5.2; injected as a callback. */
	showChatWindow: () => Promise<void>;
	/**
	 * Returns the currently chosen Tomo container ID, or `null` when no
	 * instance has ever been chosen this session (or remembered from prior).
	 */
	getChosenInstanceName: () => string | null;
}

export function registerCommands(plugin: Plugin, deps: CommandDeps): void {
	registerReconnectCommand(plugin, deps);
	plugin.addCommand({
		id: SHOW_CHAT_ID,
		name: "Show chat window",
		callback: () => {
			void deps.showChatWindow();
		},
	});
}

function registerReconnectCommand(plugin: Plugin, deps: CommandDeps): void {
	let currentLabel = "";

	const onInvoke = async (): Promise<void> => {
		const id = deps.getChosenInstanceName();
		if (id === null) {
			new Notice(NO_INSTANCE_NOTICE);
			return;
		}
		await deps.connection.forceReconnect();
	};

	const install = (name: string | null): void => {
		const label = name !== null ? `Reconnect to ${name}` : "Reconnect to Tomo";
		if (label === currentLabel) return;
		if (currentLabel !== "") plugin.removeCommand(RECONNECT_ID);
		plugin.addCommand({
			id: RECONNECT_ID,
			name: label,
			callback: () => {
				void onInvoke();
			},
		});
		currentLabel = label;
	};

	// `subscribe` fires immediately with the current value AND on every change.
	// `plugin.register(unsubscribe)` runs cleanup on plugin unload.
	plugin.register(
		connectionStore.subscribe((state) => {
			install(displayInstanceName(state));
		}),
	);
}

// ---------------------------------------------------------------------------
// 002 spec — instruction-executor command
// ---------------------------------------------------------------------------
//
// Spec refs: 002-instruction-executor phase-6 T6.1; PRD F1 (invocation
// rules); SDD "Directory Map / src/commands/registerCommands.ts".
//
// Decisions:
//
// 1. Invocation resolution lives in `resolveActiveInvocation` so both the
//    palette command (this module) and the file-menu entry (`fileMenu.ts`)
//    can call the same logic with different active-file inputs.
//
// 2. The command callback ALWAYS calls `executor.execute(invocation)`.
//    The single-run lock lives in `InstructionExecutor` (T4.5) — the command
//    must not pre-empt or cache a "busy" state, otherwise a double-click
//    would be silently swallowed before reaching the executor's lock.
//
// 3. Returns a Promise but the command callback fires-and-forgets — the
//    `ExecutionModal` subscribes to `executionStore` for live status, so
//    awaiting here adds no value and would block the command palette.

const EXECUTE_INSTRUCTIONS_ID = "execute-instructions-document";
const EXECUTE_INSTRUCTIONS_LABEL = "Execute instructions document";

export interface ExecutorCommandDeps {
	/**
	 * Narrow surface of `InstructionExecutor` — only `execute()` is needed
	 * here. Tests pass a `vi.fn`-bag that satisfies this shape; production
	 * passes the full executor.
	 */
	readonly executor: Pick<InstructionExecutor, "execute">;
	/**
	 * Vault adapter — used by `resolveActiveInvocation` to check whether the
	 * sibling `_instructions.json` for an active `.md` exists.
	 */
	readonly vault: Pick<VaultFS, "exists">;
	/**
	 * Plugin settings — read-only here. The executor itself owns settings;
	 * the command callback only inspects active-file state, never settings.
	 * Carried in the deps bag so future extensions (e.g., per-mode message
	 * gating before invocation) have the surface ready.
	 */
	readonly settings: PluginSettings;
}

/**
 * Register the 002 "Execute instructions document" palette command.
 * Called separately from `registerCommands` so that 001 and 002 wiring
 * stay decoupled — main.ts (T6.2) calls both.
 */
export function registerExecutorCommands(
	plugin: Plugin,
	deps: ExecutorCommandDeps,
): void {
	plugin.addCommand({
		id: EXECUTE_INSTRUCTIONS_ID,
		name: EXECUTE_INSTRUCTIONS_LABEL,
		callback: () => {
			void dispatchActiveInvocation(plugin, deps);
		},
	});
}

async function dispatchActiveInvocation(
	plugin: Plugin,
	deps: ExecutorCommandDeps,
): Promise<void> {
	const activePath = plugin.app.workspace.getActiveFile()?.path ?? null;
	const invocation = await resolveActiveInvocation(deps.vault, activePath);
	void deps.executor.execute(invocation);
}

/**
 * Map an active-file path to the right `Invocation` shape per PRD F1:
 *
 *   - Active path is `<stem>_instructions.json` (or any `.json` that exists)
 *     → `{ kind: "single-file", sourcePath: <that path> }`.
 *   - Active path is `<stem>.md` AND the sibling `<stem>.json` exists
 *     → `{ kind: "single-file", sourcePath: <sibling .json> }`.
 *   - Anything else (regular note, non-peer .md, .png, no active file)
 *     → `{ kind: "batch" }`.
 *
 * The single-vs-batch decision is the only routing logic; whether the
 * resolved batch is empty or the inbox folder is missing is the executor's
 * concern (PRD F1 — Notice "Tomo inbox is empty …" / "… not configured").
 */
export async function resolveActiveInvocation(
	vault: Pick<VaultFS, "exists">,
	activePath: string | null,
): Promise<Invocation> {
	if (activePath === null) {
		return { kind: "batch" };
	}
	if (activePath.endsWith(".json")) {
		if (await vault.exists(activePath)) {
			return { kind: "single-file", sourcePath: activePath };
		}
		return { kind: "batch" };
	}
	if (activePath.endsWith(".md")) {
		const sibling = activePath.slice(0, -3) + ".json";
		if (await vault.exists(sibling)) {
			return { kind: "single-file", sourcePath: sibling };
		}
	}
	return { kind: "batch" };
}

// ---------------------------------------------------------------------------
// 003 spec — IDE Bridge toggle command (T4.5)
// ---------------------------------------------------------------------------
//
// Spec refs: spec 003-ide-bridge phase-4 T4.5; PRD F13 (toggle command +
// AC Notice strings "IDE Bridge started on :23027" / "IDE Bridge stopped").
//
// Decisions:
//
// 1. The command is a pure toggle: `isRunning()` decides start-vs-stop. start()
//    and stop() are idempotent on IdeBridge, so a stale `isRunning()` read can
//    at worst issue a redundant (harmless) call — no lock needed at this layer.
//
// 2. The started Notice's port is read from `ideBridgeStore.get()` AFTER start()
//    resolves: `listening{port}` / `connected{port}` both carry the *actually
//    bound* port (which may differ from settings if the OS reassigned it). The
//    `getPort` dep is a fallback for the unreachable case where the post-start
//    state has no port. If start() landed in `error`, we surface that reason
//    instead of a misleading "started" Notice (robustness; not an AC).
//
// 3. Deps are narrowed to `Pick<IdeBridge,…>` so tests inject vi.fn spies
//    without constructing a real bridge / binding a TCP port. Production passes
//    the full `this.ideBridge` — assignment-compatible.

const TOGGLE_IDE_BRIDGE_ID = "toggle-ide-bridge";
const TOGGLE_IDE_BRIDGE_LABEL = "Toggle IDE bridge";

export interface IdeBridgeCommandDeps {
	/**
	 * Narrow surface of `IdeBridge` — only the toggle needs these three. Tests
	 * pass a vi.fn-bag; production passes the full bridge.
	 */
	readonly ideBridge: Pick<IdeBridge, "isRunning" | "start" | "stop">;
	/**
	 * Fallback port for the started Notice when the post-start store state
	 * carries no port. Reads `settings.ideBridgePort` in production.
	 */
	readonly getPort: () => number;
}

/**
 * Register the 003 "Toggle IDE bridge" palette command (PRD F13).
 * Called separately from the 001/002 registrars so the bridge wiring stays
 * decoupled — main.ts (T4.5) calls it after constructing the bridge.
 */
export function registerIdeBridgeCommand(
	plugin: Plugin,
	deps: IdeBridgeCommandDeps,
): void {
	plugin.addCommand({
		id: TOGGLE_IDE_BRIDGE_ID,
		name: TOGGLE_IDE_BRIDGE_LABEL,
		callback: () => {
			void toggleIdeBridge(deps);
		},
	});
}

// "IDE Bridge" is the proper-noun feature name; the Notice strings below are
// mandated verbatim by PRD F13 AC ("IDE Bridge started on :23027", "IDE Bridge
// stopped") and asserted by tests. Do not sentence-case them ("IDE bridge
// stopped") — that would break the AC and the test equality.
async function toggleIdeBridge(deps: IdeBridgeCommandDeps): Promise<void> {
	if (deps.ideBridge.isRunning()) {
		await deps.ideBridge.stop();
		new Notice("IDE Bridge stopped");
		return;
	}
	await deps.ideBridge.start();
	const state = ideBridgeStore.get();
	if (state.kind === "error") {
		new Notice(`IDE Bridge error: ${state.reason}`);
		return;
	}
	const port =
		state.kind === "listening" || state.kind === "connected"
			? state.port
			: deps.getPort();
	new Notice(`IDE Bridge started on :${port}`);
}
