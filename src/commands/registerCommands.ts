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
	chosenInstanceId: () => string | null;
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
		const id = deps.chosenInstanceId();
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
