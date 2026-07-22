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
	/**
	 * Every `*_instructions.json` in the inbox (sorted). Used when the active
	 * file is NOT itself an instructions doc — the command then offers a picker
	 * (batch entry + one per doc) instead of misrouting the active file (e.g. a
	 * `_suggestions.json`) into the executor, which would fail schema validation.
	 */
	readonly listInstructionsDocs: () => string[];
	/**
	 * Opens a fuzzy picker over the inbox's instruction docs — a "run whole
	 * inbox" batch entry plus one entry per doc — invoking `onPick` with the
	 * chosen `Invocation`. Injected (rather than importing the Obsidian picker
	 * here) so this module stays testable without a real `FuzzySuggestModal`.
	 */
	readonly pickInstructionsDoc: (
		docs: string[],
		onPick: (invocation: Invocation) => void,
	) => void;
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

const NO_INSTRUCTIONS_DOC_NOTICE =
	"No instruction documents (_instructions.json) found in the Tomo inbox.";

async function dispatchActiveInvocation(
	plugin: Plugin,
	deps: ExecutorCommandDeps,
): Promise<void> {
	const activePath = plugin.app.workspace.getActiveFile()?.path ?? null;
	const invocation = await resolveActiveInvocation(deps.vault, activePath);
	if (invocation !== null) {
		void deps.executor.execute(invocation);
		return;
	}
	// The active file is NOT an instructions doc (a suggestions doc, a plain
	// note, or nothing) — rather than misroute it into the executor (a
	// `_suggestions.json` would fail instructions-schema validation), offer a
	// picker over the inbox's instruction docs, with a "run whole inbox" batch
	// entry. Empty inbox ⇒ Notice.
	const docs = deps.listInstructionsDocs();
	if (docs.length === 0) {
		new Notice(NO_INSTRUCTIONS_DOC_NOTICE);
		return;
	}
	deps.pickInstructionsDoc(docs, (invocationFromPicker) => {
		void deps.executor.execute(invocationFromPicker);
	});
}

/**
 * Map an active-file path to a single-file `Invocation` when — and only when —
 * it is a genuine instructions doc:
 *
 *   - Active path is `<stem>_instructions.json` (and it exists)
 *     → `{ kind: "single-file", sourcePath: <that path> }`.
 *   - Active path is `<stem>_instructions.md` AND the sibling
 *     `<stem>_instructions.json` exists
 *     → `{ kind: "single-file", sourcePath: <sibling .json> }`.
 *   - Anything else (a `_suggestions.json`, a plain note, non-peer `.md`,
 *     `.png`, no active file) → `null`; the caller offers the instructions
 *     picker (batch entry + one per doc) instead.
 *
 * The `_instructions.json` suffix guard is the fix for the misroute bug: a
 * `_suggestions.json` is a valid `.json` but NOT an instructions source, and
 * feeding it to the executor fails schema validation ("must have required
 * property 'type'").
 */
export async function resolveActiveInvocation(
	vault: Pick<VaultFS, "exists">,
	activePath: string | null,
): Promise<Invocation | null> {
	if (activePath === null) return null;
	if (activePath.endsWith("_instructions.json")) {
		return (await vault.exists(activePath))
			? { kind: "single-file", sourcePath: activePath }
			: null;
	}
	if (activePath.endsWith(".md")) {
		const sibling = activePath.slice(0, -3) + ".json";
		if (sibling.endsWith("_instructions.json") && (await vault.exists(sibling))) {
			return { kind: "single-file", sourcePath: sibling };
		}
	}
	return null;
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

// ---------------------------------------------------------------------------
// 004 spec — Suggestions Editor open command (T4.1)
// ---------------------------------------------------------------------------
//
// Spec refs: spec-004 SDD §3 (ADR-S1); PRD F1; plan/phase-4.md T4.1.
//
// Decisions:
//
// 1. Doc-path resolution only looks at the ACTIVE file — the command opens
//    the run for whatever `_suggestions.json`/`.md` pair the user is
//    currently looking at, not a picker over every run in the vault.
// 2. `resolveSuggestionsDocPath` is exported (pure, no Obsidian dependency)
//    so its mapping rules can be asserted directly, same as
//    `resolveActiveInvocation` above.
// 3. `deps.openSuggestionsEditor` is injected rather than importing
//    `ui/suggestions-view/openSuggestionsEditor.ts` directly — keeps this
//    module's only Obsidian-side dependency the `Notice`/`Plugin` surface
//    already imported above, and lets tests substitute a spy without
//    touching real workspace leaves.

const OPEN_SUGGESTIONS_EDITOR_ID = "open-suggestions-editor";
// ADR-6: the command id above is UNCHANGED (user hotkeys bind to it) — only
// the label changed, from "Open suggestions editor" to reflect that this one
// command now suffix-dispatches to EITHER editor.
const OPEN_TOMO_EDITOR_LABEL = "Open Tomo editor";
const NO_SUGGESTIONS_DOC_NOTICE =
	"Open a Tomo _suggestions.json (or its .md) first";

/**
 * Deps for the unified "Open Tomo editor" command (ADR-6). Keeps its 004
 * name for continuity (main.ts imports it unchanged) even though it now
 * dispatches to both the Suggestions Editor and the Garden-Audit Editor —
 * `pickEditorDoc` is named generically (not `pickSuggestionsDoc`) because the
 * combined-picker fallback below shows BOTH doc families in one merged list.
 */
export interface SuggestionsEditorCommandDeps {
	/** Vault-relative path of the active file, or null if none is open. */
	readonly getActiveFilePath: () => string | null;
	/**
	 * Every `*_suggestions.json` run in the vault (sorted). Merged with
	 * `listGardenAuditDocs()` for the combined-picker fallback.
	 */
	readonly listSuggestionsDocs: () => string[];
	/**
	 * Every `*_garden-audit.json` run in the vault (sorted). Merged with
	 * `listSuggestionsDocs()` for the combined-picker fallback.
	 */
	readonly listGardenAuditDocs: () => string[];
	/**
	 * Opens a fuzzy picker over `docs` (the MERGED, sorted list of both doc
	 * families), invoking `onPick` with the chosen path. Injected (rather than
	 * importing the Obsidian picker here) so this module stays testable
	 * without a real `FuzzySuggestModal`. The dispatcher below routes the
	 * chosen path to the right opener by suffix (`GARDEN_AUDIT_JSON_RE`).
	 */
	readonly pickEditorDoc: (docs: string[], onPick: (docPath: string) => void) => void;
	/** Opens (or retargets/reveals) the Suggestions Editor leaf for docPath. */
	readonly openSuggestionsEditor: (docPath: string) => Promise<void>;
	/** Opens (or retargets/reveals) the Garden-Audit Editor leaf for docPath. */
	readonly openGardenAuditEditor: (docPath: string) => Promise<void>;
}

/**
 * Register the unified "Open Tomo editor" palette command (ADR-6). Called
 * separately from the 001/002/003 registrars so 004/005 wiring stays
 * decoupled — main.ts calls it after constructing the vault-backed openers.
 */
export function registerSuggestionsEditorCommand(
	plugin: Plugin,
	deps: SuggestionsEditorCommandDeps,
): void {
	plugin.addCommand({
		id: OPEN_SUGGESTIONS_EDITOR_ID,
		name: OPEN_TOMO_EDITOR_LABEL,
		callback: () => {
			void dispatchOpenSuggestionsEditor(deps);
		},
	});
}

/**
 * Suffix-dispatch (ADR-6): the active file decides which editor opens.
 * Garden-audit is checked first — the two resolvers are disjoint by
 * construction (T3.1), so the order only matters when NEITHER matches and the
 * active file is unrelated to both. Falls through to a combined picker over
 * every run of either kind, and only then to the Notice.
 */
async function dispatchOpenSuggestionsEditor(
	deps: SuggestionsEditorCommandDeps,
): Promise<void> {
	const activePath = deps.getActiveFilePath();

	const activeGardenAuditPath = resolveGardenAuditDocPath(activePath);
	if (activeGardenAuditPath !== null) {
		await deps.openGardenAuditEditor(activeGardenAuditPath);
		return;
	}

	const activeSuggestionsPath = resolveSuggestionsDocPath(activePath);
	if (activeSuggestionsPath !== null) {
		await deps.openSuggestionsEditor(activeSuggestionsPath);
		return;
	}

	// Neither editor's doc is active — offer a combined picker over every run
	// in the vault (owner UX refinement, extended in 005 to merge both doc
	// families), falling back to the Notice only when the vault has none of
	// either at all.
	const docs = [...deps.listGardenAuditDocs(), ...deps.listSuggestionsDocs()].sort();
	if (docs.length === 0) {
		new Notice(NO_SUGGESTIONS_DOC_NOTICE);
		return;
	}
	deps.pickEditorDoc(docs, (chosen) => {
		if (GARDEN_AUDIT_JSON_RE.test(chosen)) {
			void deps.openGardenAuditEditor(chosen);
		} else {
			void deps.openSuggestionsEditor(chosen);
		}
	});
}

// Tomo emits two suggestion review surfaces that share the SAME wire schema
// (spec-004 SDD; tomo inbox-triage.py `_get_doc_type`): the primary
// `_suggestions.json` (tomo.doc_type=suggestions) and the Force-Atomic Resolve
// `_suggestions-fan.json` (tomo.doc_type=suggestions-fan). Both open in the
// same editor; Tomo distinguishes them by frontmatter doc_type, Hashi
// discovers either by filename suffix.
export const SUGGESTIONS_JSON_RE = /_suggestions(-fan)?\.json$/;
const SUGGESTIONS_MD_RE = /_suggestions(-fan)?\.md$/;

/**
 * Map the active file path to the `_suggestions*.json` doc to open:
 *   - `<stem>_suggestions.json` / `<stem>_suggestions-fan.json` → itself.
 *   - `<stem>_suggestions.md` / `<stem>_suggestions-fan.md` → the `.json` sibling.
 *   - anything else (no active file, unrelated note) → null; the caller
 *     shows a Notice rather than opening anything.
 */
export function resolveSuggestionsDocPath(
	activePath: string | null,
): string | null {
	if (activePath === null) return null;
	if (SUGGESTIONS_JSON_RE.test(activePath)) return activePath;
	if (SUGGESTIONS_MD_RE.test(activePath)) {
		return activePath.slice(0, -".md".length) + ".json";
	}
	return null;
}

// ---------------------------------------------------------------------------
// 005 spec — garden-audit discovery resolver (T3.1)
// ---------------------------------------------------------------------------
//
// Spec refs: spec-005 SDD ADR-6; plan/phase-3.md T3.1. Disjoint from the 004
// suggestions resolver above by construction — a `_garden-audit.json` never
// matches SUGGESTIONS_JSON_RE and a `_suggestions.json` never matches
// GARDEN_AUDIT_JSON_RE — so the unified open command (T3.2 below) can check
// each resolver in turn without an ambiguous double-match.

export const GARDEN_AUDIT_JSON_RE = /_garden-audit\.json$/;
const GARDEN_AUDIT_MD_RE = /_garden-audit\.md$/;

/**
 * Map the active file path to the `_garden-audit.json` doc to open:
 *   - `<stem>_garden-audit.json` → itself.
 *   - `<stem>_garden-audit.md` → the `.json` sibling.
 *   - anything else (no active file, unrelated note, a suggestions doc) →
 *     null; the caller falls through to the next resolver / picker / Notice.
 */
export function resolveGardenAuditDocPath(
	activePath: string | null,
): string | null {
	if (activePath === null) return null;
	if (GARDEN_AUDIT_JSON_RE.test(activePath)) return activePath;
	if (GARDEN_AUDIT_MD_RE.test(activePath)) {
		return activePath.slice(0, -".md".length) + ".json";
	}
	return null;
}
