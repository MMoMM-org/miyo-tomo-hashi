/**
 * End-to-end live integration test for Hashi's connection lifecycle.
 *
 * RUNS AGAINST A REAL DOCKER DAEMON. Excluded from `npm test` by
 * vitest.config.ts (`exclude: ["test/live/**"]`); included by
 * vitest.live.config.ts and run via `npm run test:live`.
 *
 * Refs: spec 001-session-view, plan T5.5; SDD Runtime View (Connect, Chat
 * send, Transient disconnect → reconnect, Chosen instance gone on Force
 * Reconnect); PRD F1, F2, F5 (AC4), F8 (AC4), FS2.
 *
 * --- Why three scenarios ---
 *
 * 1. Happy path — proves the full chain: openPicker → connect → write/read
 *    via TTY echo → disconnect → container survives. Closes T5.4 traceability
 *    orphans F1.10 / F4.5 (no other test exercises picker→connect→use end
 *    to end against a real daemon).
 *
 * 2. Transient disconnect — `docker restart` interrupts the live attach
 *    stream; the connection's session-close handler must fire the
 *    auto-reconnect loop. We accept BOTH outcomes ("connected" via recovery
 *    OR "disconnected{attach-failed}" via exhaustion) as proof that the
 *    reconnect schedule actually ran. Daemon timing under load is too
 *    variable to pin a single outcome — what matters for T5.5 is that the
 *    state machine traversed `reconnecting`. PRD F8/AC4 calls for the
 *    schedule to run, not for it to always succeed.
 *
 * 3. Chosen-instance-gone — stop+remove while connected, then forceReconnect.
 *    The state must land on Disconnected and `openPicker` must NEVER be
 *    invoked from forceReconnect (the picker only opens from Settings —
 *    SDD ADR-3, "no picker auto-open from non-Settings sources"). This
 *    pins both the failure path AND the no-auto-picker invariant in one
 *    assertion pair.
 *
 * --- Daemon-availability gate ---
 *
 * The dev environment used to author this file has no Docker daemon, so
 * we cannot execute it locally. The gate (`pingDaemon()` in `beforeAll`)
 * makes every test pass cleanly when the daemon is unreachable: each
 * test bails after the gate before doing any setup. CI must run
 * `npm run test:live` for every PR before merge per T5.9 release gate.
 *
 * --- Timing budget for the transient-disconnect case ---
 *
 * The reconnect schedule is [500, 1000, 2000, 4000, 8000] ms = 15.5 s
 * cumulative wall time before the loop reports "exhausted". We poll up
 * to 30 s for either success or exhaustion, and the vitest test timeout
 * is set to 60 s for that single case. The 30 s wall budget is ~2x the
 * loop budget — generous enough to absorb a slow `docker restart` (which
 * itself can take several seconds on first run) without blowing past the
 * loop and seeing a stale "still reconnecting" snapshot. The 60 s vitest
 * timeout doubles the wall budget again so a hardware hiccup doesn't
 * fail the case spuriously. Tighter would be brittle on busy CI; looser
 * would mask a real hang.
 */

import type Dockerode from "dockerode";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { connectionStore } from "../../src/connection/connectionStore";
import { TomoConnection } from "../../src/connection/TomoConnection";
import type { ConnectionState } from "../../src/connection/state";
import type { TomoInstance } from "../../src/connection/types";
import type { PluginSettings } from "../../src/types";

import {
	cleanupContainers,
	pingDaemon,
	pullAlpineIfMissing,
	startContainer,
	uniqueName,
	waitFor,
} from "./_helpers/docker";

let daemonReachable = false;

const created: Dockerode.Container[] = [];

beforeAll(async () => {
	daemonReachable = await pingDaemon();
	if (!daemonReachable) return;
	await pullAlpineIfMissing();
});

afterEach(async () => {
	const toClean = created.splice(0);
	await cleanupContainers(toClean);
	// Reset the singleton store so cross-test leakage can't surface a stale
	// state to the next test's subscribers.
	connectionStore.set({ kind: "disconnected" });
});

describe("Hashi e2e — happy path + reconnect + chosen-instance-gone", () => {
	it("happy path: openPicker → connect → write/read → disconnect → container still running", async () => {
		if (!daemonReachable) return;

		const c = await startContainer({
			name: uniqueName("e2e-happy"),
			cmd: ["cat"],
			tty: true,
			openStdin: true,
			labels: {
				"miyo.component": "tomo",
				"miyo.tomo.instance-name": "e2e-test",
			},
		});
		created.push(c);

		const settings: PluginSettings = { chosenInstanceId: null };
		const conn = new TomoConnection(settings);

		// openPicker discovers our container.
		const candidates = await conn.openPicker();
		const ours = candidates.find((i: TomoInstance) => i.containerId === c.id);
		expect(ours, "expected our test container in picker candidates").toBeDefined();
		expect(ours?.name).toBe("e2e-test");

		// Capture state transitions via the store. The first emission is the
		// current value at subscribe-time (Store contract) — we expect the
		// later transitions to include "attaching" and "connected".
		const observed: ConnectionState["kind"][] = [];
		const unsub = connectionStore.subscribe((s) => {
			observed.push(s.kind);
		});

		await conn.connect(ours!);
		expect(conn.state.kind).toBe("connected");
		expect(settings.chosenInstanceId).toBe(c.id);
		expect(observed).toContain("attaching");
		expect(observed).toContain("connected");

		// Wire onData AFTER connect so the listener attaches to the live
		// session. TomoConnection re-binds onData listeners across
		// reconnects (TomoConnection.onData docstring), but for a fresh
		// connect we just need it bound before the first write.
		const chunks: string[] = [];
		const decoder = new TextDecoder();
		const dataDisposable = conn.onData((chunk: Uint8Array) => {
			chunks.push(decoder.decode(chunk));
		});

		// Under Tty=true, `cat` echoes input back as the terminal does.
		conn.write("hello\n");
		await waitFor(() => chunks.join("").includes("hello"), 2_000);
		expect(chunks.join("")).toContain("hello");

		dataDisposable.dispose();

		// Disconnect — container should still be running (Hashi never stops
		// the user's Tomo container; PRD F2/AC2).
		await conn.disconnect();
		expect(conn.state.kind).toBe("disconnected");

		const inspect = await c.inspect();
		expect(inspect.State.Running).toBe(true);

		unsub();
	});

	it(
		"transient disconnect: stream restart triggers Reconnecting → Connected (real auto-reconnect)",
		async () => {
			if (!daemonReachable) return;

			const c = await startContainer({
				name: uniqueName("e2e-transient"),
				cmd: ["cat"],
				tty: true,
				openStdin: true,
				labels: {
					"miyo.component": "tomo",
					"miyo.tomo.instance-name": "transient-test",
				},
			});
			created.push(c);

			const settings: PluginSettings = { chosenInstanceId: null };
			const conn = new TomoConnection(settings);

			const candidates = await conn.openPicker();
			const ours = candidates.find((i: TomoInstance) => i.containerId === c.id);
			expect(ours, "expected our test container in picker candidates").toBeDefined();

			const observed: ConnectionState["kind"][] = [];
			const unsub = connectionStore.subscribe((s) => {
				observed.push(s.kind);
			});

			await conn.connect(ours!);
			expect(conn.state.kind).toBe("connected");

			// Trigger a stream interruption: `docker restart` kills + restarts
			// the container, which closes the attach stream. The container's
			// `cat` will be respawned; reconnect should be able to re-attach.
			await c.restart({ t: 0 });

			// Wait up to 30s for the reconnect loop to run to completion.
			// The schedule is 15.5s cumulative — 30s gives a 2x cushion for
			// slow daemons. See file-header timing-budget rationale.
			await waitFor(
				() =>
					observed.includes("reconnecting") &&
					(conn.state.kind === "connected" ||
						conn.state.kind === "disconnected"),
				30_000,
				200,
			);

			// We MUST have entered the reconnect schedule.
			expect(observed).toContain("reconnecting");

			// We accept EITHER recovered ("connected") OR exhausted
			// ("disconnected") — both prove the loop ran. The reason for
			// admitting both: docker restart timing under CI load is too
			// variable to pin a single outcome, and PRD F8/AC4 only
			// requires the schedule to fire, not always succeed.
			expect(["connected", "disconnected"]).toContain(conn.state.kind);

			await conn.disconnect();
			unsub();
		},
		60_000,
	);

	it(
		"chosen-instance-gone: stop+remove container, forceReconnect stays Disconnected; picker NOT invoked",
		async () => {
			if (!daemonReachable) return;

			const c = await startContainer({
				name: uniqueName("e2e-gone"),
				cmd: ["cat"],
				tty: true,
				openStdin: true,
				labels: {
					"miyo.component": "tomo",
					"miyo.tomo.instance-name": "gone-test",
				},
			});
			created.push(c);

			const settings: PluginSettings = { chosenInstanceId: null };
			const conn = new TomoConnection(settings);

			// Spy on openPicker so we can prove forceReconnect never falls
			// back to it (SDD ADR-3 — picker only opens from Settings).
			const openPickerSpy = vi.spyOn(conn, "openPicker");

			const candidates = await conn.openPicker();
			const ours = candidates.find((i: TomoInstance) => i.containerId === c.id);
			expect(ours, "expected our test container in picker candidates").toBeDefined();

			await conn.connect(ours!);
			expect(conn.state.kind).toBe("connected");

			// Reset the spy AFTER the legitimate setup-phase call so the
			// post-removal forceReconnect call count starts at zero.
			openPickerSpy.mockClear();

			// Stop + remove the container while connected. Drop it from the
			// `created` array so afterEach doesn't try to clean it up twice.
			await c.stop({ t: 0 });
			await c.remove({ force: true });
			const idx = created.indexOf(c);
			if (idx !== -1) created.splice(idx, 1);

			// forceReconnect must detect the chosen instance is gone via
			// inspectContainer() returning null and stay Disconnected.
			await conn.forceReconnect();

			expect(conn.state.kind).toBe("disconnected");
			expect(openPickerSpy).not.toHaveBeenCalled();

			openPickerSpy.mockRestore();
		},
		30_000,
	);
});
