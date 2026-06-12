/**
 * window shim for the live test suite.
 *
 * Production connection code (e.g. `ReconnectLoop.wait`) schedules retries via
 * `window.setTimeout` — the correct global in Obsidian's Electron renderer, and
 * the form the `obsidianmd` lint rule mandates over bare `setTimeout`. The live
 * suite runs that production code under vitest's `node` environment, which has
 * no `window`, so the call throws `ReferenceError: window is not defined`.
 *
 * The unit suite avoids this because it runs under `jsdom` (which provides
 * `window`). The live suite must stay on `node` for real socket/stream
 * behaviour, so we alias `window` to `globalThis` here — `window.setTimeout`
 * then resolves to node's timer, which is behaviourally equivalent for the
 * reconnect scheduler.
 */

// Index-cast so the assignment does not have to satisfy the ambient
// `window: Window & typeof globalThis` global type — we only need the timer
// functions, which globalThis already carries in node.
const g = globalThis as unknown as Record<string, unknown>;
if (g["window"] === undefined) {
	g["window"] = globalThis;
}
