/**
 * Shared context type threaded through every tool handler in Phase 2.
 *
 * Each tool handler receives (params, adapter, ctx). ctx carries injected
 * state that would otherwise require tight coupling to concrete implementations:
 * the tracker (T2.6) produces `getLatest` and the orchestrator (T3.2) wires it
 * here, so tool handlers stay pure relative to injected state and are testable
 * without a live tracker.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD "Tool registry".
 */

import type { SelectionChangedParams } from "../protocol";

/**
 * Injected context for all tool handlers.
 * `getLatest` retrieves the last-broadcast selection from the tracker cache.
 * Wired by the orchestrator (T3.2); stubbed in unit tests.
 */
export type ToolContext = {
	getLatest: () => SelectionChangedParams | null;
};
