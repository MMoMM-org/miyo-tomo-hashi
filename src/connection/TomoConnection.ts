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
 * 2. `chosenInstanceId` is mutated on `this.settings` on entering Connected,
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
	inspectContainer,
	listTomoInstances,
} from "./docker";
import { ReconnectLoop } from "./reconnectLoop";
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
	if (chunk instanceof Uint8Array) return chunk;
	if (typeof chunk === "string") return Buffer.from(chunk);
	if (Buffer.isBuffer(chunk)) return new Uint8Array(chunk);
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

	constructor(
		private settings: PluginSettings,
		private persist: (settings: PluginSettings) => Promise<void> = async () => {},
	) {}

	get state(): ConnectionState {
		return this.currentState;
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

		try {
			const session = await attach(target.containerId);
			if (epoch !== this.epoch) {
				// A concurrent transition happened (disconnect / dispose / new
				// connect). Drop this session quietly.
				await session.close();
				return;
			}
			this.installSession(session, target);
			this.settings.chosenInstanceId = target.containerId;
			await this.persist(this.settings);
			this.setState({ kind: "connected", instance: target });
		} catch (err: unknown) {
			if (epoch !== this.epoch) return;
			this.setState({ kind: "disconnected", reason: toConnectionError(err) });
		}
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

		try {
			const info = await inspectContainer(target.containerId);
			if (epoch !== this.epoch) return;
			if (info === null) {
				this.setState({
					kind: "disconnected",
					reason: { code: "attach-failed", detail: DETAIL_GONE },
				});
				return;
			}
			const session = await attach(target.containerId);
			if (epoch !== this.epoch) {
				await session.close();
				return;
			}
			this.installSession(session, target);
			this.settings.chosenInstanceId = target.containerId;
			await this.persist(this.settings);
			this.setState({ kind: "connected", instance: target });
		} catch (err: unknown) {
			if (epoch !== this.epoch) return;
			this.setState({ kind: "disconnected", reason: toConnectionError(err) });
		}
	}

	async autoReconnectIfRemembered(): Promise<void> {
		if (this.disposed) return;
		// Idempotent on second call — no-op when not Disconnected.
		if (this.currentState.kind !== "disconnected") return;
		const id = this.settings.chosenInstanceId;
		if (id === null) return;

		this.bumpEpoch();
		const epoch = this.epoch;

		try {
			const info = await inspectContainer(id);
			if (epoch !== this.epoch) return;
			if (info === null) {
				this.setState({
					kind: "disconnected",
					reason: { code: "attach-failed", detail: DETAIL_GONE },
				});
				return;
			}
			// We need a TomoInstance descriptor for state.attaching.target. Pull
			// the matching one from listTomoInstances; if not present, build a
			// minimal one from the inspect payload. (`info` is intentionally
			// only used as a presence check here — we re-resolve the full
			// descriptor below.)
			void info;
			const target = await this.resolveInstanceForId(id);
			if (epoch !== this.epoch) return;

			this.setState({ kind: "attaching", target });
			const session = await attach(id);
			if (epoch !== this.epoch) {
				await session.close();
				return;
			}
			this.installSession(session, target);
			this.settings.chosenInstanceId = target.containerId;
			await this.persist(this.settings);
			this.setState({ kind: "connected", instance: target });
		} catch (err: unknown) {
			if (epoch !== this.epoch) return;
			this.setState({ kind: "disconnected", reason: toConnectionError(err) });
		}
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

	private async resolveInstanceForId(id: string): Promise<TomoInstance> {
		// Best-effort: try to find the full descriptor via discovery so we
		// pick up labels and accurate startedAt. If list fails, synthesize
		// a minimal descriptor from id alone — image string is unknown at
		// this fallback path; we use a sentinel that the picker UI will
		// override on the next discovery pass.
		try {
			const all = await listTomoInstances();
			const hit = all.find((x) => x.containerId === id);
			if (hit !== undefined) return hit;
		} catch {
			// Swallow — fall through to synthesis. The connect attempt below
			// will surface any real daemon error.
		}
		return {
			containerId: id,
			shortId: id.slice(0, 12),
			name: null,
			startedAt: new Date(),
			image: "unknown",
		};
	}

	private installSession(session: AttachSession, target: TomoInstance): void {
		this.session = session;
		this.currentTarget = target;
		this.bindStreamData(session);
		session.onClose((reason) => {
			void this.handleSessionClose(reason, session, target);
		});
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
			nextDelayMs: 500,
		});

		const loop = new ReconnectLoop();
		this.reconnectLoop = loop;

		const result = await loop.run(
			async () => {
				if (epoch !== this.epoch) return false;
				try {
					const info = await inspectContainer(target.containerId);
					if (epoch !== this.epoch) return false;
					if (info === null) {
						this.setState({
							kind: "disconnected",
							reason: { code: "attach-failed", detail: DETAIL_GONE },
						});
						loop.cancel();
						return false;
					}
					const session = await attach(target.containerId);
					if (epoch !== this.epoch) {
						await session.close();
						return false;
					}
					this.installSession(session, target);
					this.settings.chosenInstanceId = target.containerId;
					await this.persist(this.settings);
					this.setState({ kind: "connected", instance: target });
					return true;
				} catch {
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
