/**
 * Live integration test for src/connection/docker.ts → listTomoInstances().
 *
 * RUNS AGAINST A REAL DOCKER DAEMON. Excluded from `npm test` by
 * vitest.config.ts (`exclude: ["test/live/**"]`); included by
 * vitest.live.config.ts and run via `npm run test:live`.
 *
 * Refs: spec 001-session-view, plan T2.2; SDD ADR-1 (no DOCKER_HOST,
 * explicit socketPath); PRD F1/AC1, F1/AC5.
 *
 * --- What this test pins ---
 *
 * 1. Label-scoped discovery against a real daemon — `listTomoInstances()`
 *    only returns containers carrying `miyo.component=tomo`.
 * 2. `miyo.tomo.instance-name` → `TomoInstance.name`; missing/empty label
 *    maps to `null`.
 * 3. `miyo.plugin-enabled=false` does NOT exclude a container from the
 *    discovery scope. The label is a Tomo-side advisory; v0.1 Hashi only
 *    filters on `miyo.component=tomo` (per spec README decisions log
 *    2026-04-24).
 *
 * --- Daemon-availability gate ---
 *
 * The dev environment used to author this file has no Docker daemon, so
 * we cannot execute it locally. The gate (`docker.ping()` in `beforeAll`)
 * makes every test pass cleanly when the daemon is unreachable: each
 * test bails after the gate before doing any setup. CI is expected to
 * provide a daemon and exercise the assertions in full (plan T2.4).
 */

import process from "node:process";

import Dockerode from "dockerode";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { listTomoInstances } from "../../src/connection/docker";
import type { TomoInstance } from "../../src/connection/types";

// --- daemon handle -----------------------------------------------------------

const docker = new Dockerode({
	socketPath:
		process.platform === "win32"
			? "\\\\.\\pipe\\docker_engine"
			: "/var/run/docker.sock",
});

const TEST_IMAGE = "alpine:latest";

let daemonReachable = false;

// --- helpers -----------------------------------------------------------------

async function pullAlpineIfMissing(): Promise<void> {
	try {
		await docker.getImage(TEST_IMAGE).inspect();
		return;
	} catch {
		// fall through to pull
	}
	const stream: NodeJS.ReadableStream = await docker.pull(TEST_IMAGE);
	await new Promise<void>((resolve, reject) => {
		docker.modem.followProgress(stream, (err: Error | null) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

interface StartOpts {
	readonly name: string;
	readonly labels: Record<string, string>;
}

async function startContainer(opts: StartOpts): Promise<Dockerode.Container> {
	const c = await docker.createContainer({
		Image: TEST_IMAGE,
		// Long-lived but cheaply killable; sleep keeps the container in
		// the "running" state without spinning a CPU.
		Cmd: ["sh", "-c", "sleep 3600"],
		Labels: opts.labels,
		name: opts.name,
	});
	await c.start();
	return c;
}

function uniqueName(slug: string): string {
	// Suffix with high-resolution time to avoid collisions across parallel
	// test runs (e.g. CI matrix). Docker container names are unique per
	// daemon, so a stale leftover would otherwise wedge the suite.
	return `hashi-disco-${slug}-${Date.now()}-${Math.floor(
		Math.random() * 1e6,
	)}`;
}

function findById(
	instances: readonly TomoInstance[],
	id: string,
): TomoInstance | undefined {
	return instances.find((i) => i.containerId === id);
}

// --- per-test cleanup --------------------------------------------------------

let created: Dockerode.Container[] = [];

afterEach(async () => {
	const toClean = created;
	created = [];
	for (const c of toClean) {
		// stop() may race with an already-stopped container (e.g. test
		// failure mid-run). remove({ force: true }) is the authoritative
		// teardown; the stop is best-effort and swallowed.
		try {
			await c.stop();
		} catch {
			// ignore
		}
		try {
			await c.remove({ force: true });
		} catch {
			// ignore — container may have been removed already
		}
	}
});

// --- daemon gate -------------------------------------------------------------

beforeAll(async () => {
	try {
		await docker.ping();
		daemonReachable = true;
	} catch {
		daemonReachable = false;
		return;
	}
	await pullAlpineIfMissing();
});

// --- tests -------------------------------------------------------------------

describe("listTomoInstances() — live Docker", () => {
	it("returns one instance with name when miyo.tomo.instance-name label is present", async () => {
		if (!daemonReachable) return;

		const c = await startContainer({
			name: uniqueName("test-a"),
			labels: {
				"miyo.component": "tomo",
				"miyo.tomo.instance-name": "test-a",
			},
		});
		created.push(c);

		const before = Date.now();
		const instances: TomoInstance[] = await listTomoInstances();
		const after = Date.now();

		// Filter to just the one we created — other miyo.component=tomo
		// containers might be present on a developer daemon and would
		// otherwise make this assertion flaky. CI runs against a clean
		// daemon, but the filter is correct in both worlds.
		const ours = findById(instances, c.id);
		expect(ours, "expected our test container in discovery results").toBeDefined();
		if (ours === undefined) return; // narrow for TS; expect already failed

		expect(ours.name).toBe("test-a");
		expect(ours.containerId).toBe(c.id);
		expect(ours.shortId).toBe(c.id.slice(0, 12));
		expect(ours.image).toBe(TEST_IMAGE);

		// startedAt comes from ContainerInfo.Created (epoch seconds, see
		// src/connection/docker.ts module-header decision 2). Created is
		// when the container was created, so it must fall on or before
		// "after" and within ~30s of "before" — generous enough for slow
		// daemons / pull-in-progress noise but strict enough to catch a
		// completely wrong field.
		const started = ours.startedAt.getTime();
		expect(started).toBeGreaterThan(before - 30_000);
		expect(started).toBeLessThanOrEqual(after);
	});

	it("maps a container with no instance-name label to name: null", async () => {
		if (!daemonReachable) return;

		const named = await startContainer({
			name: uniqueName("named"),
			labels: {
				"miyo.component": "tomo",
				"miyo.tomo.instance-name": "test-named",
			},
		});
		created.push(named);

		const unnamed = await startContainer({
			name: uniqueName("unnamed"),
			labels: { "miyo.component": "tomo" },
		});
		created.push(unnamed);

		const instances = await listTomoInstances();

		const namedInstance = findById(instances, named.id);
		const unnamedInstance = findById(instances, unnamed.id);

		expect(namedInstance, "named container missing from discovery").toBeDefined();
		expect(unnamedInstance, "unnamed container missing from discovery").toBeDefined();
		if (namedInstance === undefined || unnamedInstance === undefined) return;

		expect(namedInstance.name).toBe("test-named");
		expect(unnamedInstance.name).toBeNull();
		expect(namedInstance.image).toBe(TEST_IMAGE);
		expect(unnamedInstance.image).toBe(TEST_IMAGE);
	});

	it("does NOT exclude containers with miyo.plugin-enabled=false — only miyo.component=tomo is the filter gate", async () => {
		// Pins the v0.1 scope decision (spec README decisions log
		// 2026-04-24): `miyo.plugin-enabled` is a Tomo-side advisory, not
		// a Hashi filter. Discovery surfaces the container regardless of
		// its value. If we ever introduce a plugin-enabled gate, this
		// test must be updated together with the spec.
		if (!daemonReachable) return;

		const c = await startContainer({
			name: uniqueName("advisory"),
			labels: {
				"miyo.component": "tomo",
				"miyo.plugin-enabled": "false",
				"miyo.tomo.instance-name": "advisory-only",
			},
		});
		created.push(c);

		const instances = await listTomoInstances();
		const ours = findById(instances, c.id);

		expect(ours, "container with plugin-enabled=false was excluded — scope regression").toBeDefined();
		if (ours === undefined) return;

		expect(ours.name).toBe("advisory-only");
	});
});
