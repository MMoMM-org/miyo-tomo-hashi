/**
 * Unit tests for src/connection/docker.ts — thin wrappers around dockerode.
 *
 * Approach: vi.mock("dockerode") with a scripted class exposing the small
 * surface we touch (listContainers, getContainer, container.inspect,
 * container.attach, modem.demuxStream). Per ADR-5 v2, no DockerClient port
 * exists — these helpers are the only seam, and a module-level mock is the
 * recommended pattern for unit coverage. Live Docker is exercised in
 * test/live/.
 */

import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// --- dockerode module mock ---------------------------------------------------
//
// vitest hoists vi.mock above imports, so the factory cannot capture
// outer-scope `vi.fn()` references directly. We expose the scripted mocks
// through a singleton accessor that the factory and the tests both read.

interface DockerodeMockHandles {
	listContainers: Mock;
	inspect: Mock;
	attach: Mock;
	resize: Mock;
	demuxStream: Mock;
	getContainer: Mock;
	dockerodeCtor: Mock;
}

const handles: DockerodeMockHandles = {
	listContainers: vi.fn(),
	inspect: vi.fn(),
	attach: vi.fn(),
	resize: vi.fn(),
	demuxStream: vi.fn(),
	getContainer: vi.fn(),
	dockerodeCtor: vi.fn(),
};

vi.mock("dockerode", () => {
	class Dockerode {
		public modem = { demuxStream: handles.demuxStream };
		public listContainers = handles.listContainers;
		public getContainer = handles.getContainer;
		constructor(options?: unknown) {
			handles.dockerodeCtor(options);
		}
	}
	return { default: Dockerode };
});

beforeEach(() => {
	handles.listContainers.mockReset();
	handles.inspect.mockReset();
	handles.attach.mockReset();
	handles.resize.mockReset();
	handles.demuxStream.mockReset();
	handles.getContainer.mockReset();
	handles.dockerodeCtor.mockReset();
	handles.getContainer.mockImplementation(() => ({
		inspect: handles.inspect,
		attach: handles.attach,
		resize: handles.resize,
	}));
});

// --- helpers under test (imported lazily so the mock is in place) ------------

import {
	attach,
	inspectContainer,
	listTomoInstances,
	type AttachSession,
} from "../../../src/connection/docker";

// --- listTomoInstances -------------------------------------------------------

describe("listTomoInstances()", () => {
	it("maps fields and sorts by startedAt DESC (newest first)", async () => {
		// NOTE: Decision documented in module comment of src/connection/docker.ts:
		// SDD says startedAt comes from container.State.StartedAt (ISO 8601), but
		// dockerode's listContainers ContainerInfo shape exposes only `Created`
		// (epoch seconds). We use Created for sort+display in the picker —
		// functionally equivalent within seconds. True StartedAt would cost
		// N round trips via inspect.
		const newestCreatedSec = 1_714_300_000; // 2024-04-28
		const middleCreatedSec = 1_714_200_000;
		const oldestCreatedSec = 1_714_100_000;

		handles.listContainers.mockResolvedValue([
			{
				Id: "c".repeat(64),
				Image: "miyo/tomo:0.7.0",
				Created: middleCreatedSec,
				Labels: {
					"miyo.component": "tomo",
					"miyo.tomo.instance-name": "middle",
				},
			},
			{
				Id: `b${"0".repeat(63)}`,
				Image: "miyo/tomo:0.7.0",
				Created: newestCreatedSec,
				// no instance-name label → name should be null
				Labels: { "miyo.component": "tomo" },
			},
			{
				Id: `a${"0".repeat(63)}`,
				Image: "miyo/tomo:0.6.2",
				Created: oldestCreatedSec,
				Labels: {
					"miyo.component": "tomo",
					"miyo.tomo.instance-name": "",
				},
			},
		]);

		const instances = await listTomoInstances();

		expect(handles.listContainers).toHaveBeenCalledTimes(1);
		const arg = handles.listContainers.mock.calls[0]?.[0] as {
			filters?: { label?: string[] };
		};
		expect(arg.filters?.label).toEqual(["miyo.component=tomo"]);

		expect(instances).toHaveLength(3);
		expect(instances[0]?.startedAt.getTime()).toBe(newestCreatedSec * 1000);
		expect(instances[1]?.startedAt.getTime()).toBe(middleCreatedSec * 1000);
		expect(instances[2]?.startedAt.getTime()).toBe(oldestCreatedSec * 1000);

		// Newest has no name label → null
		expect(instances[0]?.name).toBeNull();
		expect(instances[0]?.shortId).toBe(`b${"0".repeat(11)}`);
		expect(instances[0]?.containerId).toHaveLength(64);
		expect(instances[0]?.image).toBe("miyo/tomo:0.7.0");

		// Middle has the explicit name
		expect(instances[1]?.name).toBe("middle");

		// Oldest has empty-string label → null (per discovery algorithm)
		expect(instances[2]?.name).toBeNull();
	});

	it("returns empty array when no containers match", async () => {
		handles.listContainers.mockResolvedValue([]);
		await expect(listTomoInstances()).resolves.toEqual([]);
	});

	it("constructs Dockerode with explicit socketPath (refuses DOCKER_HOST per ADR-1)", async () => {
		// Force a fresh module evaluation so the lazy-singleton client is
		// rebuilt and the constructor spy is exercised in this test.
		vi.resetModules();
		handles.listContainers.mockResolvedValue([]);
		const fresh = (await import("../../../src/connection/docker")) as typeof import("../../../src/connection/docker");
		await fresh.listTomoInstances();

		expect(handles.dockerodeCtor).toHaveBeenCalled();
		const opts = handles.dockerodeCtor.mock.calls[0]?.[0] as
			| { socketPath?: string }
			| undefined;
		expect(opts).toBeDefined();
		expect(typeof opts?.socketPath).toBe("string");
		expect(opts?.socketPath?.length).toBeGreaterThan(0);
	});
});

// --- inspectContainer --------------------------------------------------------

describe("inspectContainer()", () => {
	it("returns null when dockerode rejects with statusCode 404", async () => {
		const err = Object.assign(new Error("no such container"), {
			statusCode: 404,
		});
		handles.inspect.mockRejectedValue(err);

		const result = await inspectContainer("a".repeat(64));
		expect(result).toBeNull();
		expect(handles.getContainer).toHaveBeenCalledWith("a".repeat(64));
	});

	it("rethrows non-404 errors", async () => {
		const err = Object.assign(new Error("server boom"), { statusCode: 500 });
		handles.inspect.mockRejectedValue(err);
		await expect(inspectContainer("a".repeat(64))).rejects.toBe(err);
	});

	it("returns the inspect result on success", async () => {
		const stub = {
			Id: "a".repeat(64),
			State: { StartedAt: "2026-04-28T07:00:00Z" },
			Config: { Tty: false, Labels: {} },
			Image: "miyo/tomo:0.7.0",
		};
		handles.inspect.mockResolvedValue(stub);
		const result = await inspectContainer("a".repeat(64));
		expect(result).toBe(stub);
	});
});

// --- attach ------------------------------------------------------------------

describe("attach()", () => {
	const VALID_ID = "a".repeat(64);

	function inspectStub(tty: boolean) {
		return {
			Id: VALID_ID,
			State: { StartedAt: "2026-04-28T07:00:00Z" },
			Config: { Tty: tty, Labels: {} },
			Image: "miyo/tomo:0.7.0",
		};
	}

	it("TTY mode: returns AttachSession exposing the raw stream as stdout/stdin", async () => {
		handles.inspect.mockResolvedValue(inspectStub(true));
		const stream = new PassThrough();
		handles.attach.mockResolvedValue(stream);

		const session = await attach(VALID_ID);

		// stdin write reaches the raw stream
		const seen: Buffer[] = [];
		stream.on("data", (chunk: Buffer) => seen.push(chunk));
		session.stdin.write("hello");
		await new Promise((r) => setImmediate(r));
		expect(Buffer.concat(seen).toString()).toBe("hello");

		// stdout emits configured bytes (write back into the same PassThrough — TTY
		// path means the raw duplex IS stdout)
		const out: Buffer[] = [];
		session.stdout.on("data", (chunk: Buffer) => out.push(chunk));
		stream.write("server-says-hi");
		await new Promise((r) => setImmediate(r));
		expect(Buffer.concat(out).toString()).toContain("server-says-hi");

		// close() resolves once
		await expect(session.close()).resolves.toBeUndefined();
		// idempotent — second call must not throw
		await expect(session.close()).resolves.toBeUndefined();
	});

	it("TTY mode: onClose fires once with 'user' when close() is called", async () => {
		handles.inspect.mockResolvedValue(inspectStub(true));
		handles.attach.mockResolvedValue(new PassThrough());

		const session = await attach(VALID_ID);
		const cb = vi.fn();
		session.onClose(cb);

		await session.close();
		await session.close(); // idempotent

		expect(cb).toHaveBeenCalledTimes(1);
		expect(cb).toHaveBeenCalledWith("user");
	});

	it("non-TTY mode: invokes modem.demuxStream(stream, stdoutPT, stderrPT)", async () => {
		handles.inspect.mockResolvedValue(inspectStub(false));
		const stream = new PassThrough();
		handles.attach.mockResolvedValue(stream);

		const session = await attach(VALID_ID);

		expect(handles.demuxStream).toHaveBeenCalledTimes(1);
		const call = handles.demuxStream.mock.calls[0] as
			| [unknown, unknown, unknown]
			| undefined;
		expect(call?.[0]).toBe(stream);
		// stdout target and stderr target are writable streams (PassThrough)
		expect(call?.[1]).toBeDefined();
		expect(call?.[2]).toBeDefined();

		// stdin still writes through the raw stream
		const seen: Buffer[] = [];
		stream.on("data", (c: Buffer) => seen.push(c));
		session.stdin.write("ping");
		await new Promise((r) => setImmediate(r));
		expect(Buffer.concat(seen).toString()).toBe("ping");

		await session.close();
	});

	it("throws ConnectionError 'attach-failed' when inspect returns null (404)", async () => {
		const err = Object.assign(new Error("nope"), { statusCode: 404 });
		handles.inspect.mockRejectedValue(err);

		await expect(attach(VALID_ID)).rejects.toMatchObject({
			code: "attach-failed",
		});
		// attach should not have been called when inspect failed
		expect(handles.attach).not.toHaveBeenCalled();
	});

	it("typed return: AttachSession contract has the expected shape", async () => {
		handles.inspect.mockResolvedValue(inspectStub(true));
		handles.attach.mockResolvedValue(new PassThrough());

		const session: AttachSession = await attach(VALID_ID);
		// Typecheck-flavoured runtime assertions
		expect(typeof session.close).toBe("function");
		expect(typeof session.onClose).toBe("function");
		expect(typeof session.resize).toBe("function");
		expect(session.stdout).toBeDefined();
		expect(session.stdin).toBeDefined();

		await session.close();
	});

	it("resize(rows, cols) calls dockerode container.resize({h, w}) with rows→h, cols→w", async () => {
		// PTY-resize bug: Tomo runs with `docker run -it`, so the container's
		// pty has a fixed default size. Without forwarding xterm's actual size,
		// Claude Code in the container draws TUI frames (spinner, status bar,
		// input box) for 80x24 while xterm renders at the real viewport size,
		// leaving cursor backsteps and line-clears on the wrong cells. The
		// AttachSession.resize() pass-through is what closes that gap.
		handles.inspect.mockResolvedValue(inspectStub(true));
		handles.attach.mockResolvedValue(new PassThrough());
		handles.resize.mockResolvedValue(undefined);

		const session = await attach(VALID_ID);
		await session.resize(45, 173);

		expect(handles.resize).toHaveBeenCalledTimes(1);
		expect(handles.resize).toHaveBeenCalledWith({ h: 45, w: 173 });

		await session.close();
	});

	it("resize() rejection propagates so callers can decide retry policy", async () => {
		handles.inspect.mockResolvedValue(inspectStub(true));
		handles.attach.mockResolvedValue(new PassThrough());
		const boom = new Error("container gone");
		handles.resize.mockRejectedValue(boom);

		const session = await attach(VALID_ID);
		await expect(session.resize(24, 80)).rejects.toBe(boom);

		await session.close();
	});

	it("resize() after close() is a no-op (does not call dockerode)", async () => {
		handles.inspect.mockResolvedValue(inspectStub(true));
		handles.attach.mockResolvedValue(new PassThrough());
		handles.resize.mockResolvedValue(undefined);

		const session = await attach(VALID_ID);
		await session.close();
		await expect(session.resize(24, 80)).resolves.toBeUndefined();

		expect(handles.resize).not.toHaveBeenCalled();
	});
});

