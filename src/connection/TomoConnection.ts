/**
 * TomoConnection — the single state machine that owns the lifecycle of an
 * attach to a Tomo Docker container, mirrors transitions to the
 * `connectionStore`, and surfaces stream plumbing (write / onData) to the
 * view layer.
 *
 * Spec: docs/XDD/specs/001-session-view —
 *   - SDD "TomoConnection Service Surface"
 *   - SDD Runtime View (4 sequence diagrams: Connect, Chat send, Transient
 *     disconnect → reconnect, Chosen instance gone on Force Reconnect)
 * PRD: F1 (discover), F2 (connect/disconnect), F5 (chat send), F8
 *   (auto-reconnect + force-reconnect), FS2 (remember last connected).
 *
 * --- Decisions ---
 *
 * 1. Epoch-based cancellation. Every operation that starts an in-flight
 *    `attach()` captures `this.epoch`. Concurrent transitions (disconnect
 *    while attaching, dispose while reconnecting, force-reconnect while
 *    auto-reconnecting) bump the epoch; when the in-flight attach resolves
 *    we compare the captured epoch against the live one and close+drop the
 *    session if they diverge. This is cheaper than wiring an AbortController
 *    through `dockerode`'s callback-style attach.
 *
 * 2. `chosenInstanceName` is mutated on `this.settings` on entering Connected,
 *    NOT cleared on disconnect (FS2: remember last connected). T3.4 wires a
 *    `persist` callback through the constructor so the settings object is
 *    flushed to plugin data on every Connected transition; on Disconnect
 *    the value stays put across sessions (PRD FS2/AC1) and the callback is
 *    not invoked. The plugin-side wiring of `persist → plugin.saveData()`
 *    happens in Phase 5 (main.ts integration).
 *
 * 3. Reconnect attempts inspect first, then attach. If inspect returns null
 *    we surface chosen-instance-gone immediately; the loop is cancelled and
 *    the state lands at Disconnected{attach-failed/chosen-instance-gone}
 *    (per the SDD failure flow for force-reconnect, applied symmetrically).
 *
 * 4. `onData` listeners persist across reconnects. A Set of callbacks is
 *    kept on the instance and re-bound to every new AttachSession.stdout
 *    `'data'` event. Disposing a listener removes it from the Set and from
 *    the live stream.
 *
 * 5. The "only TomoConnection writes" rule (ADR-4 v3) is convention only —
 *    every transition here calls `connectionStore.set(...)` so the store
 *    and `this.currentState` never diverge.
 */

import { Buffer } from "node:buffer";

import type { PluginSettings } from "../types";

import { connectionStore } from "./connectionStore";
import {
	type AttachSession,
	ConnectionFailure,
	attach,
	findInstanceByName,
	inspectContainer,
	listTomoInstances,
} from "./docker";
import { INITIAL_RECONNECT_DELAY_MS, ReconnectLoop } from "./reconnectLoop";
import type { ConnectionState } from "./state";
import type { ConnectionError, TomoInstance } from "./types";

type DataListener = (chunk: Uint8Array) => void;

interface Disposable {
	dispose(): void;
}

const DETAIL_GONE = "Chosen Tomo instance no longer exists.";
const DETAIL_EXHAUSTED = "Reconnect attempts exhausted.";

function streamErrorDetail(message: string): string {
	return `Stream error: ${message}`;
}

function isConnectionFailure(err: unknown): err is ConnectionFailure {
	return err instanceof ConnectionFailure;
}

function toConnectionError(err: unknown): ConnectionError {
	if (isConnectionFailure(err)) {
		// Reconstruct the discriminated-union member from the carrier.
		switch (err.code) {
			case "daemon-unreachable":
				return { code: "daemon-unreachable", detail: err.detail };
			case "socket-permission-denied":
				return { code: "socket-permission-denied", detail: err.detail };
			case "no-instances":
				return {
					code: "no-instances",
					detail:
						"No Tomo instance seems to be running — start one and try again.",
				};
			case "attach-failed":
				return { code: "attach-failed", detail: err.detail };
		}
	}
	const message =
		err instanceof Error ? err.message : "unknown attach failure";
	return { code: "attach-failed", detail: streamErrorDetail(message) };
}

function chunkToUint8Array(chunk: unknown): Uint8Array {
	// Node Buffer is a Uint8Array subclass, so the instanceof check below
	// covers both — the previous separate `Buffer.isBuffer` branch was
	// dead code (review round 2 / L5), and re-wrapping the buffer with
	// `new Uint8Array(buffer)` allocated a redundant view per chunk.
	if (chunk instanceof Uint8Array) return chunk;
	if (typeof chunk === "string") return Buffer.from(chunk);
	// Fallback — preserve bytes by going through Buffer.from on `String(chunk)`.
	return Buffer.from(String(chunk));
}

export class TomoConnection {
	private currentState: ConnectionState = { kind: "disconnected" };
	private session: AttachSession | null = null;
	private currentTarget: TomoInstance | null = null;
	private dataListeners = new Set<DataListener>();
	private streamDataBinding: ((chunk: unknown) => void) | null = null;
	private reconnectLoop: ReconnectLoop | null = null;
	private epoch = 0;
	private disposed = false;
	// Last xterm geometry observed by the view. Cached so that any new
	// AttachSession (initial connect, force-reconnect, auto-reconnect after
	// remote close) can be resynced to the user's actual viewport without
	// the view layer having to remember and replay the size itself.
	// `docker run -it` creates a container PTY at a fixed default 80x24,
	// so without this re-sync the post-reconnect terminal would silently
	// drift back to the wrong geometry.
	private lastTerminalSize: { rows: number; cols: number } | null = null;

	constructor(
		private settings: PluginSettings,
		private persist: (settings: PluginSettings) => Promise<void> = async () => {},
	) {}

	get state(): ConnectionState {
		return this.currentState;
	}

	/**
	 * Shared attach-install-persist-setState path used by every lifecycle
	 * method (review M4). Pre-fix the same shape — `attach → epoch-check →
	 * installSession → persistChosenInstanceBestEffort → setState(connected)`
	 * — was inlined in connect(), forceReconnect(),
	 * autoReconnectIfRemembered(), and the inner attempt of
	 * startAutoReconnect(). The duplication invited subtle drift between
	 * sites (one called resolveLiveInstance, another didn't; the order of
	 * persist vs setState varied across versions). One helper, one truth.
	 *
	 * Returns:
	 *   "installed" — happy path; state is now `connected`.
	 *   "stale"     — concurrent transition observed; session closed and
	 *                 dropped quietly. Caller should return without
	 *                 changing state (a newer flow already owns it).
	 *   ConnectionError — attach() threw. Caller decides whether to drive
	 *                 setState({disconnected, reason}) or absorb the error
	 *                 (e.g., reconnect-loop short-circuit branches).
	 */
	private async attemptAttach(
		target: TomoInstance,
		capturedEpoch: number,
	): Promise<"installed" | "stale" | ConnectionError> {
		let session: AttachSession;
		try {
			session = await attach(target.containerId);
		} catch (err: unknown) {
			return toConnectionError(err);
		}
		if (capturedEpoch !== this.epoch) {
			await session.close();
			return "stale";
		}
		this.installSession(session, target);
		await this.persistChosenInstanceBestEffort(target.name);
		this.setState({ kind: "connected", instance: target });
		return "installed";
	}

	/**
	 * Persist `chosenInstanceName` as a best-effort save (review M5). The
	 * pre-fix code did `await this.persist(...)` between `installSession()`
	 * and `setState({kind:"connected"})` — if persist threw, the live
	 * AttachSession was wired but `currentState` was forced to
	 * `disconnected` by the surrounding catch, leaving a hybrid state
	 * where `write()` and `forceReconnect()` both behaved wrong. Now: a
	 * persist failure logs and continues; the session install + state
	 * transition own correctness. The user is connected; their next
	 * reload just won't auto-reconnect to this instance until they pick
	 * again.
	 */
	private async persistChosenInstanceBestEffort(
		name: string | null,
	): Promise<void> {
		this.settings.chosenInstanceName = name;
		try {
			await this.persist(this.settings);
		} catch (err: unknown) {
			// v0.1 trade-off (review round 2 / L4): console.warn only,
			// not a user-visible Notice. Persist failures are rare
			// (Obsidian's saveData backs onto a vetted fs op chain) and
			// the user is now CONNECTED — surfacing a Notice on every
			// connect would be noisy. The downside is silent: their
			// next reload won't auto-reconnect to this instance until
			// they pick it again. If users report "I picked X, it
			// connected, but next time it didn't auto-reconnect" we
			// should promote this to a Notice via an injected callback.
			console.warn("[hashi] failed to persist chosenInstanceName:", err);
		}
	}

	get instanceName(): string | null {
		const s = this.currentState;
		if (s.kind === "connected") return s.instance.name ?? s.instance.shortId;
		if (s.kind === "attaching" || s.kind === "reconnecting") {
			return s.target.name ?? s.target.shortId;
		}
		return null;
	}

	async openPicker(): Promise<TomoInstance[]> {
		return await listTomoInstances();
	}

	async connect(target: TomoInstance): Promise<void> {
		if (this.disposed) return;
		this.bumpEpoch();
		const epoch = this.epoch;

		this.setState({ kind: "attaching", target });
		this.currentTarget = target;

		const result = await this.attemptAttach(target, epoch);
		if (result === "installed" || result === "stale") return;
		if (epoch !== this.epoch) return;
		this.setState({ kind: "disconnected", reason: result });
	}

	async disconnect(): Promise<void> {
		if (this.currentState.kind === "disconnected") return;
		this.bumpEpoch();
		await this.teardownSession();
		this.cancelReconnect();
		this.setState({ kind: "disconnected" });
	}

	async forceReconnect(): Promise<void> {
		if (this.disposed) return;
		const target = this.targetForReconnect();
		if (target === null) return;

		this.bumpEpoch();
		const epoch = this.epoch;

		await this.teardownSession();
		this.cancelReconnect();

		this.setState({ kind: "attaching", target });

		// Resolve by name first if we have one — that's what survives a
		// container restart (new ID, same instance-name label). Fall back
		// to the cached containerId for nameless instances.
		let live: TomoInstance | null;
		try {
			live = await this.resolveLiveInstance(target);
		} catch (err: unknown) {
			if (epoch !== this.epoch) return;
			this.setState({ kind: "disconnected", reason: toConnectionError(err) });
			return;
		}
		if (epoch !== this.epoch) return;
		if (live === null) {
			this.setState({
				kind: "disconnected",
				reason: { code: "attach-failed", detail: DETAIL_GONE },
			});
			return;
		}
		const result = await this.attemptAttach(live, epoch);
		if (result === "installed" || result === "stale") return;
		if (epoch !== this.epoch) return;
		this.setState({ kind: "disconnected", reason: result });
	}

	async autoReconnectIfRemembered(): Promise<void> {
		if (this.disposed) return;
		// Idempotent on second call — no-op when not Disconnected.
		if (this.currentState.kind !== "disconnected") return;
		const name = this.settings.chosenInstanceName;
		if (name === null) return;

		this.bumpEpoch();
		const epoch = this.epoch;

		// Resolve the persisted name to whatever container ID is currently
		// running. Survives docker stop+start (new ID, same name label) —
		// the original FS2 path inspected by container ID and broke on
		// every restart, forcing the user back into the picker.
		let target: TomoInstance | null;
		try {
			target = await findInstanceByName(name);
		} catch (err: unknown) {
			if (epoch !== this.epoch) return;
			this.setState({ kind: "disconnected", reason: toConnectionError(err) });
			return;
		}
		if (epoch !== this.epoch) return;
		if (target === null) {
			this.setState({
				kind: "disconnected",
				reason: { code: "attach-failed", detail: DETAIL_GONE },
			});
			return;
		}

		this.setState({ kind: "attaching", target });
		const result = await this.attemptAttach(target, epoch);
		if (result === "installed" || result === "stale") return;
		if (epoch !== this.epoch) return;
		this.setState({ kind: "disconnected", reason: result });
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.bumpEpoch();
		this.cancelReconnect();
		await this.teardownSession();
		this.dataListeners.clear();
		this.setState({ kind: "disconnected" });
	}

	write(data: string): void {
		if (this.currentState.kind !== "connected" || this.session === null) {
			throw new ConnectionFailure({
				code: "attach-failed",
				detail: "Cannot write while not connected.",
			});
		}
		this.session.stdin.write(data);
	}

	async resize(rows: number, cols: number): Promise<void> {
		this.lastTerminalSize = { rows, cols };
		if (this.session === null) return;
		try {
			await this.session.resize(rows, cols);
		} catch {
			// Best-effort: a transient docker error here is recoverable on the
			// next xterm-resize event, and there's nothing the user can act on
			// in the moment. installSession() also reapplies on every new
			// session, so a brief failure doesn't strand the geometry.
		}
	}

	onData(cb: DataListener): Disposable {
		this.dataListeners.add(cb);
		return {
			dispose: (): void => {
				this.dataListeners.delete(cb);
			},
		};
	}

	// --- internals -----------------------------------------------------------

	private bumpEpoch(): void {
		this.epoch += 1;
	}

	private setState(next: ConnectionState): void {
		this.currentState = next;
		connectionStore.set(next);
	}

	private targetForReconnect(): TomoInstance | null {
		if (this.currentTarget !== null) return this.currentTarget;
		const s = this.currentState;
		if (s.kind === "connected") return s.instance;
		if (s.kind === "attaching" || s.kind === "reconnecting") return s.target;
		return null;
	}

	private async resolveLiveInstance(
		target: TomoInstance,
	): Promise<TomoInstance | null> {
		// Prefer name resolution: that's what survives docker stop+start.
		// The cached `target.containerId` may be stale if the container was
		// restarted between the original connect and now (force-reconnect /
		// auto-reconnect-after-remote-close).
		if (target.name !== null) {
			const byName = await findInstanceByName(target.name);
			if (byName !== null) return byName;
			// Name no longer matches anything running — caller treats as gone.
			return null;
		}
		// No name label — fall back to inspect-by-ID for legacy/unlabeled
		// instances. inspectContainer returns null on 404 (gone).
		const info = await inspectContainer(target.containerId);
		if (info === null) return null;
		return target;
	}

	private installSession(session: AttachSession, target: TomoInstance): void {
		this.session = session;
		this.currentTarget = target;
		this.bindStreamData(session);
		session.onClose((reason) => {
			void this.handleSessionClose(reason, session, target);
		});
		// Re-apply the cached xterm geometry so a fresh container PTY (which
		// always starts at the docker-run -it default) immediately matches
		// the actual viewport. Fire-and-forget: errors are swallowed for the
		// same reason as resize() above.
		if (this.lastTerminalSize !== null) {
			const { rows, cols } = this.lastTerminalSize;
			void session.resize(rows, cols).catch(() => {});
		}
	}

	private bindStreamData(session: AttachSession): void {
		// Re-bind the multiplexer for this session's stdout so persistent
		// onData listeners stay live across reconnects.
		const handler = (chunk: unknown): void => {
			if (this.dataListeners.size === 0) return;
			const view = chunkToUint8Array(chunk);
			for (const cb of this.dataListeners) {
				try {
					cb(view);
				} catch {
					// Listener errors must not crash the stream.
				}
			}
		};
		this.streamDataBinding = handler;
		session.stdout.on("data", handler);
	}

	private unbindStreamData(): void {
		if (this.session !== null && this.streamDataBinding !== null) {
			this.session.stdout.off("data", this.streamDataBinding);
		}
		this.streamDataBinding = null;
	}

	private async teardownSession(): Promise<void> {
		const s = this.session;
		this.unbindStreamData();
		this.session = null;
		if (s !== null) {
			await s.close();
		}
	}

	private cancelReconnect(): void {
		if (this.reconnectLoop !== null) {
			this.reconnectLoop.cancel();
			this.reconnectLoop = null;
		}
	}

	private async handleSessionClose(
		reason: "user" | "remote" | "error",
		session: AttachSession,
		target: TomoInstance,
	): Promise<void> {
		// Ignore stale close events from sessions we already replaced.
		if (this.session !== session) return;
		if (reason === "user") return;
		if (this.disposed) return;
		if (this.currentState.kind !== "connected") return;

		await this.startAutoReconnect(target);
	}

	private async startAutoReconnect(target: TomoInstance): Promise<void> {
		this.bumpEpoch();
		const epoch = this.epoch;

		// Drop the dead session reference but DON'T re-call close — the close
		// has already happened (that's what brought us here).
		this.unbindStreamData();
		this.session = null;

		this.setState({
			kind: "reconnecting",
			target,
			attempt: 1,
			nextDelayMs: INITIAL_RECONNECT_DELAY_MS,
		});

		const loop = new ReconnectLoop();
		this.reconnectLoop = loop;

		const result = await loop.run(
			async () => {
				if (epoch !== this.epoch) return false;
				try {
					const live = await this.resolveLiveInstance(target);
					if (epoch !== this.epoch) return false;
					if (live === null) {
						this.setState({
							kind: "disconnected",
							reason: { code: "attach-failed", detail: DETAIL_GONE },
						});
						loop.cancel();
						return false;
					}
					// M4: shared attach-install-persist path.
					const r = await this.attemptAttach(live, epoch);
					if (r === "stale") return false;
					if (r === "installed") return true;
					// `r` is a ConnectionError — fall through to the catch
					// branch via throw so the existing non-transient-error
					// short-circuit logic owns the disposition.
					throw new ConnectionFailure(r);
				} catch (err: unknown) {
					// Non-transient errors short-circuit the loop. A
					// permission-denied, daemon-unreachable, or no-instances
					// error will not resolve by waiting; retrying 5× across
					// 15.5 s just delays the named error the user needs to
					// act on. Transient errors (`attach-failed` for stream
					// race / 404 / etc.) still ride the full backoff
					// schedule. Spec ref: requirements.md F1/AC12 (added
					// 2026-04-28). `no-instances` added in review round 2 /
					// M2 — defensive: no source code currently throws it
					// into the reconnect path, but if a future caller adds
					// one, the loop should not waste the user's time
					// waiting for containers that are not coming back.
					if (
						isConnectionFailure(err) &&
						(err.code === "socket-permission-denied" ||
							err.code === "daemon-unreachable" ||
							err.code === "no-instances")
					) {
						if (epoch === this.epoch) {
							this.setState({
								kind: "disconnected",
								reason: toConnectionError(err),
							});
						}
						loop.cancel();
						return false;
					}
					return false;
				}
			},
			(attemptNumber, nextDelayMs) => {
				if (epoch !== this.epoch) return;
				this.setState({
					kind: "reconnecting",
					target,
					attempt: attemptNumber,
					nextDelayMs,
				});
			},
		);

		if (epoch !== this.epoch) return;
		this.reconnectLoop = null;

		if (result === "exhausted") {
			this.setState({
				kind: "disconnected",
				reason: { code: "attach-failed", detail: DETAIL_EXHAUSTED },
			});
		}
		// "success" — already transitioned to connected inside the attempt fn.
		// "cancelled" — transition was set by whoever cancelled (chosen-gone
		// branch above sets disconnected before cancelling; user disconnect
		// sets disconnected after cancelling).
	}
}
