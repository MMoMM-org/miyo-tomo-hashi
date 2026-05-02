/**
 * HookRunner — loads and invokes per-action hooks with policy enforcement.
 *
 * Design:
 *   - Hooks are loaded fresh per run via cache-evict (ADR-3).
 *   - Policy: enabled | disabled | ask. disabled is the kill-switch.
 *   - ask: in-memory session map; first detection → askCallback; subsequent
 *     calls for the same key use the remembered decision (enable-session) or
 *     re-prompt (enable-once, disable).
 *   - Timeout: Promise.race with an injected timeoutMs (default 30_000).
 *     NOTE: only protects against ASYNC hangs; synchronous infinite loops
 *     block the event loop and cannot be killed in single-threaded Node.
 *   - The HookDisclosureModal callback (askCallback) is wired in Phase 5;
 *     Phase 4 stubs via an injected callback.
 *
 * ADR-3 caveat: only the entry file's require.cache entry is evicted.
 *   Transitive imports (e.g. _helper.js) remain cached across runs.
 *
 * [ref: PRD/F8; ADR-3; ADR-10 v2; T4.4]
 */

import type { App } from "obsidian";
import type { Action, ActionKind } from "../schema/types.js";
import type { HookContext, HookLogger } from "./HookContext.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type HookPhase = "before" | "after";
export type HookKey = `${HookPhase}-${ActionKind}`;
export type HookPolicy = "enabled" | "disabled" | "ask";
export type AskDecision = "enable-session" | "enable-once" | "disable";

export type Hook = (ctx: HookContext) =>
	| undefined
	| { info?: string[]; warnings?: string[]; errors?: string[] }
	| Promise<undefined | { info?: string[]; warnings?: string[]; errors?: string[] }>;

export type HookOutcome =
	| { kind: "ok" }
	| { kind: "messages"; info: string[]; warnings: string[] }
	| { kind: "failed"; reason: string };

export type AskCallback = (hookPath: string) => Promise<AskDecision>;

/**
 * Resolved hook reference returned by `HookLoader.resolve`. The optional
 * `fingerprint` (size + mtimeMs) lets HookRunner detect file replacement
 * between ask-mode runs and re-prompt the user — see review M1. Loaders
 * that cannot supply a fingerprint (e.g., test stubs) simply omit it; the
 * staleness guard then degrades to the prior cached-decision behavior.
 */
export interface ResolvedHook {
	absolutePath: string;
	duplicates: string[];
	fingerprint?: { size: number; mtimeMs: number };
}

export interface HookLoader {
	resolve(key: HookKey): ResolvedHook | null;
}

/** Minimal require-function interface — avoids the deprecated NodeRequire / RequireFn globals. */
export interface RequireFn {
	(id: string): unknown;
	resolve(id: string): string;
	cache: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const noopHook: Hook = () => undefined;

function loadHookFresh(absolutePath: string, requireFn: RequireFn): Hook {
	const resolved = requireFn.resolve(absolutePath);
	// review round 2 / L22: evict the entry file AND every other cached
	// CJS module that shares its directory prefix. Pre-fix only the
	// entry was evicted, so a hook doing `require("./_helper")` kept
	// the helper cached across runs; a user editing the helper between
	// two enable-session runs executed the OLD helper while believing
	// they had approved the fresh code. Targeted prefix eviction
	// (same-directory) is safer than a full cache flush — node_modules
	// stays warm.
	const dirPrefix = resolved.endsWith(".js") || resolved.endsWith(".cjs")
		? resolved.slice(0, resolved.lastIndexOf("/") + 1)
		: resolved;
	for (const key of Object.keys(requireFn.cache)) {
		if (key.startsWith(dirPrefix)) {
			delete requireFn.cache[key];
		}
	}
	const mod = requireFn(absolutePath) as { default?: Hook } | Hook;
	if (typeof mod === "function") return mod;
	if (typeof (mod as { default?: Hook }).default === "function") {
		return (mod as { default: Hook }).default;
	}
	return noopHook;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	// Capture the timer handle so we can clear it after the race resolves
	// (review M3). Promise.race only resolves the winner — the loser
	// timer would otherwise stay alive for the full `ms` window, holding
	// its closure (and surrounding context) until it fires.
	let timerId: ReturnType<typeof setTimeout> | null = null;
	const timeoutPromise = new Promise<T>((_, reject) => {
		timerId = setTimeout(
			() => reject(new Error(`Hook exceeded ${ms}ms timeout`)),
			ms,
		);
	});
	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timerId !== null) clearTimeout(timerId);
	}
}

// ---------------------------------------------------------------------------
// HookRunner
// ---------------------------------------------------------------------------

// Internal record paired with each remembered ask-mode decision. We keep
// the file fingerprint that was approved so a later resolve() with a
// changed fingerprint forces a re-prompt (review M1).
interface SessionDecisionRecord {
	decision: AskDecision;
	fingerprint?: { size: number; mtimeMs: number };
}

function fingerprintsMatch(
	a: { size: number; mtimeMs: number } | undefined,
	b: { size: number; mtimeMs: number } | undefined,
): boolean {
	// If either side lacks a fingerprint we cannot prove staleness, so we
	// fall back to the prior trust-the-cache behavior. FsHookLoader always
	// supplies one in production; only test stubs would omit it.
	if (a === undefined || b === undefined) return true;
	return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

export class HookRunner {
	private readonly sessionDecisions = new Map<HookKey, SessionDecisionRecord>();
	private readonly requireFn: RequireFn;
	private readonly timeoutMs: number;
	private readonly askCallback: AskCallback;
	private readonly policy: HookPolicy;

	constructor(
		private readonly app: App,
		private readonly loader: HookLoader,
		private readonly logger: HookLogger,
		options: {
			timeoutMs?: number;
			requireFn: RequireFn;
			askCallback?: AskCallback;
			policy: HookPolicy;
		},
	) {
		this.timeoutMs = options.timeoutMs ?? 30_000;
		this.requireFn = options.requireFn;
		this.askCallback =
			options.askCallback ??
			(() => Promise.resolve<AskDecision>("disable"));
		this.policy = options.policy;
	}

	async run(phase: HookPhase, action: Action): Promise<HookOutcome> {
		if (this.policy === "disabled") return { kind: "ok" };

		const key: HookKey = `${phase}-${action.action}`;
		const resolved = this.loader.resolve(key);
		if (resolved === null) return { kind: "ok" };

		const { absolutePath, duplicates } = resolved;

		for (const dup of duplicates) {
			this.logger.warn(
				`Hook conflict for key "${key}": duplicate file ignored: ${dup}`,
			);
		}

		if (this.policy === "ask") {
			const decision = await this.resolveAskDecision(
				key,
				absolutePath,
				resolved.fingerprint,
			);
			if (decision === "disable") return { kind: "ok" };
		}

		const hookFn = loadHookFresh(absolutePath, this.requireFn);
		const ctx: HookContext = {
			action,
			app: this.app,
			logger: this.logger,
		};

		return this.invoke(phase, hookFn, ctx);
	}

	resetSessionDecisions(): void {
		this.sessionDecisions.clear();
	}

	private async resolveAskDecision(
		key: HookKey,
		absolutePath: string,
		fingerprint: { size: number; mtimeMs: number } | undefined,
	): Promise<AskDecision> {
		const remembered = this.sessionDecisions.get(key);
		// Re-prompt if (a) no remembered decision, OR (b) the file changed
		// since approval (review M1). Bounds the trust window to a single
		// file identity even within one session.
		if (
			remembered !== undefined &&
			fingerprintsMatch(remembered.fingerprint, fingerprint)
		) {
			return remembered.decision;
		}

		const decision = await this.askCallback(absolutePath);
		if (decision === "enable-session" || decision === "disable") {
			this.sessionDecisions.set(key, { decision, fingerprint });
		}
		// enable-once: invoke this time but don't store → next call re-prompts
		return decision;
	}

	private async invoke(
		phase: HookPhase,
		hookFn: Hook,
		ctx: HookContext,
	): Promise<HookOutcome> {
		let result: Awaited<ReturnType<Hook>>;
		try {
			result = await withTimeout(
				Promise.resolve(hookFn(ctx)),
				this.timeoutMs,
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			const label = phase === "before" ? "before-hook threw" : "after-hook threw";
			return { kind: "failed", reason: `${label}: ${msg}` };
		}

		if (result === undefined || result === null) return { kind: "ok" };

		const errors = result.errors ?? [];
		if (errors.length > 0) {
			const reason = `hook returned errors: ${errors.join("; ")}`;
			return { kind: "failed", reason };
		}

		const info = result.info ?? [];
		const warnings = result.warnings ?? [];

		for (const msg of info) this.logger.info(msg);
		for (const msg of warnings) this.logger.warn(msg);

		if (info.length === 0 && warnings.length === 0) return { kind: "ok" };
		return { kind: "messages", info, warnings };
	}
}
