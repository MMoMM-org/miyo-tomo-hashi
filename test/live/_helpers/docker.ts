/**
 * Shared helpers for live Docker tests under `test/live/`.
 *
 * Consolidates the daemon-ping / image-pull / container start+cleanup pattern
 * that previously lived inline in `docker-discovery.live.test.ts` and
 * `docker-attach.live.test.ts`. Single source of truth for the live-test
 * scaffolding so the e2e file (T5.5) and any future live tests reuse it.
 *
 * Refs: spec 001-session-view, plan T5.5; SDD ADR-1 (no DOCKER_HOST,
 * explicit socketPath).
 *
 * --- Daemon-availability gate ---
 *
 * The dev environment used to author these files has no Docker daemon, so
 * we cannot execute live tests locally. Each test file calls `pingDaemon()`
 * in `beforeAll`; when the daemon is unreachable the test bails after the
 * gate before doing any setup. CI is expected to provide a daemon and
 * exercise the assertions in full (plan T2.4 / T5.9).
 */

import process from "node:process";

import Dockerode from "dockerode";

// --- daemon handle -----------------------------------------------------------

export const TEST_IMAGE = "alpine:latest";

export const docker = new Dockerode({
	socketPath:
		process.platform === "win32"
			? "\\\\.\\pipe\\docker_engine"
			: "/var/run/docker.sock",
});

// --- ping / pull -------------------------------------------------------------

export async function pingDaemon(): Promise<boolean> {
	try {
		await docker.ping();
		return true;
	} catch {
		return false;
	}
}

export async function pullAlpineIfMissing(): Promise<void> {
	try {
		await docker.getImage(TEST_IMAGE).inspect();
		return;
	} catch {
		// fall through to pull
	}
	const stream = await docker.pull(TEST_IMAGE);
	await new Promise<void>((resolve, reject) => {
		docker.modem.followProgress(stream, (err: Error | null) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

// --- container helpers -------------------------------------------------------

export interface StartContainerOpts {
	readonly name: string;
	/** Defaults to a long-lived `sleep 3600`. */
	readonly cmd?: readonly string[];
	/** Defaults to `false`. */
	readonly tty?: boolean;
	readonly labels?: Record<string, string>;
	/** Defaults to `false`. When true, also sets AttachStdin. */
	readonly openStdin?: boolean;
}

export async function startContainer(
	opts: StartContainerOpts,
): Promise<Dockerode.Container> {
	const c = await docker.createContainer({
		Image: TEST_IMAGE,
		// Long-lived but cheaply killable; sleep keeps the container in the
		// "running" state without spinning a CPU.
		Cmd: opts.cmd !== undefined ? [...opts.cmd] : ["sh", "-c", "sleep 3600"],
		Tty: opts.tty ?? false,
		OpenStdin: opts.openStdin ?? false,
		AttachStdin: opts.openStdin ?? false,
		AttachStdout: true,
		AttachStderr: true,
		Labels: opts.labels,
		name: opts.name,
	});
	await c.start();
	return c;
}

/**
 * Best-effort teardown: stop({ t: 0 }) avoids the default 10s graceful-stop
 * wait; remove({ force: true }) is the authoritative teardown. Both calls
 * swallow errors because either may race with a container that already
 * stopped or was already removed by the test body.
 */
export async function cleanupContainers(
	containers: readonly Dockerode.Container[],
): Promise<void> {
	for (const c of containers) {
		try {
			await c.stop({ t: 0 });
		} catch {
			// ignore — may already be stopped
		}
		try {
			await c.remove({ force: true });
		} catch {
			// ignore — may already be gone
		}
	}
}

export function uniqueName(slug: string): string {
	// Suffix with high-resolution time + jitter to avoid collisions across
	// parallel test runs (e.g. CI matrix). Docker container names are unique
	// per daemon, so a stale leftover would otherwise wedge the suite.
	return `hashi-${slug}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export async function waitFor(
	predicate: () => boolean,
	timeoutMs: number,
	pollMs = 50,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise<void>((r) => setTimeout(r, pollMs));
	}
}
