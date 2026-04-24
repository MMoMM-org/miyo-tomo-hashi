---
title: "Phase 2: Docker Boundary"
status: pending
version: "1.0"
phase: 2
---

# Phase 2: Docker Boundary

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- PRD: `docs/XDD/specs/001-session-view/requirements.md` — F1 Connect/picker, F9 error categories
- SDD: `docs/XDD/specs/001-session-view/solution.md` — "Docker Client Port", "Integration Points", ADR-1, ADR-5, "Implementation Gotchas" (TTY demux)

**Key Decisions** (affecting this phase):
- ADR-1: `dockerode` as the Docker client
- ADR-5: ports & adapters; `DockerClient` interface + `DockerodeAdapter` impl
- ADR-10: live tests hit real Docker (no mocks at this boundary)

**Dependencies**: Phase 1 complete (types + obsidian mock + deps installed).

---

## Tasks

This phase produces a fully-tested Docker edge that the connection service in Phase 3 consumes. Unit tests use a fake client; live tests exercise the real adapter against a running Docker daemon.

- [ ] **T2.1 Define `DockerClient` port + `AttachSession` contract** `[activity: domain-modeling]`

  1. Prime: Read SDD "Docker Client Port" `[ref: SDD/Interface Specifications; Docker Client Port]` and "Integration Points / Docker_Engine".
  2. Test: Write `test/unit/docker/DockerClient.contract.test.ts` that spec-tests a `FakeDockerClient`:
     - `listTomoInstances()` returns configured instances sorted by `startedAt` desc
     - `inspect(id)` returns null for unknown IDs
     - `attach(id)` returns an `AttachSession` whose `stdout` emits configured bytes, whose `stdin` writes are captured, and whose `close()` resolves once
  3. Implement: Create `src/docker/DockerClient.ts` with the `DockerClient` interface, `AttachSession` interface, and a `FakeDockerClient` test factory (exported from the same file or a sibling `FakeDockerClient.ts` — pick one, keep it consistent).
  4. Validate: Contract test passes; types strict.
  5. Success:
     - [ ] Interface matches SDD contract exactly `[ref: SDD/Docker Client Port]`
     - [ ] Fake is usable in downstream unit tests `[ref: SDD/ADR-5]`

- [ ] **T2.2 Implement `DockerodeAdapter` (list + inspect)** `[activity: integration]`

  1. Prime: Read [dockerode docs](https://github.com/apocas/dockerode) on `listContainers({ filters })` and `getContainer(id).inspect()`; review SDD "Docker discovery result mapping" algorithm `[ref: SDD/Runtime View; Complex Logic - Discovery result mapping]`.
  2. Test: Write `test/live/docker-discovery.live.test.ts`:
     - Start a disposable container with labels `miyo.component=tomo` and `miyo.tomo.instance-name=test-a`; call `listTomoInstances()`; expect one instance with name `test-a`
     - Start a second container without the instance-name label; expect two instances, one with `name: null`
     - Start a third container with `miyo.component=tomo`, `miyo.plugin-enabled=false`; **explicitly verify the current scope excludes only the `miyo.component=tomo` filter** (SDD does not filter on `plugin-enabled` — this label is a Tomo-side advisory but not a filter gate in v0.1 per README decisions log 2026-04-24)
     - Cleanup: `docker stop && docker rm` all containers in `afterEach`
  3. Implement: Create `src/docker/DockerodeAdapter.ts`:
     - Constructor accepts an optional `Dockerode` instance (default `new Dockerode()` which auto-detects socket path)
     - `listTomoInstances()` → `listContainers({ filters: { label: ['miyo.component=tomo'] } })` → map to `TomoInstance[]` per SDD algorithm; sort by `startedAt` desc
     - `inspect(id)` → `getContainer(id).inspect()` → map to `TomoInstance` or null on 404
  4. Validate: Live test passes against a real daemon (`npm run test:live`); error paths produce `ConnectionError` with correct `code`.
  5. Success:
     - [ ] Label-scoped discovery works against real Docker `[ref: PRD/F1/AC1; SDD/ADR-1]`
     - [ ] Missing instance-name label → `name: null` graceful fallback `[ref: PRD/F1/AC5]`
     - [ ] Inspect returns null (not throws) for missing containers `[ref: SDD/Docker Client Port]`

- [ ] **T2.3 Implement `DockerodeAdapter.attach` with TTY demux detection** `[activity: integration]`

  1. Prime: Read SDD "Implementation Gotchas / Attach stream demuxing" `[ref: SDD/Implementation Gotchas]` and dockerode's `container.attach({ stream, stdout, stderr, stdin, logs })` docs.
  2. Test: Write `test/live/docker-attach.live.test.ts`:
     - Run `alpine:latest cat` with `tty: true`; attach; write "hello\n" to stdin; expect to receive "hello\n" on stdout within 2 s; close; expect onClose("user")
     - Run `alpine:latest sh -c 'echo out; echo err 1>&2; cat'` with `tty: false`; attach; expect demuxed stdout and stderr frames to arrive separately
     - `close()` must be idempotent: calling twice does not throw
  3. Implement:
     - `attach(id)` calls `inspect(id)` first to detect `Config.Tty`; opens `container.attach({ stream: true, stdout: true, stderr: true, stdin: true, logs: false })`
     - When `tty: true`: return the raw Duplex as both stdout and stdin (client sees a single bidirectional stream)
     - When `tty: false`: use dockerode's `modem.demuxStream(stream, stdoutPT, stderrPT)` where `stdoutPT`/`stderrPT` are `PassThrough` streams; return stdout merged with stderr via a PassThrough (keeping ordering best-effort); stdin is the raw stream
     - `close()` → detach cleanly; emit `onClose(reason)` with `"user"` on explicit close, `"remote"` on EOF, `"error"` on stream error
  4. Validate: Both live-test scenarios pass; close is idempotent; no socket leaks (check `process._getActiveHandles` length returns to baseline).
  5. Success:
     - [ ] Bidirectional stream confirmed end-to-end `[ref: PRD/F4/AC5; SDD/ADR-2]`
     - [ ] TTY and non-TTY containers both supported `[ref: SDD/Implementation Gotchas]`
     - [ ] Clean teardown `[ref: SDD/Deployment View; Rollback]`

- [ ] **T2.4 Phase 2 Validation** `[activity: validate]`

  - Run `npm test && npm run test:live`. Unit tests green. Live tests green against a local Docker daemon. Lint clean. Tick Phase 2 checkbox in `plan/README.md`.
  - If `test:live` cannot run (no Docker on dev machine), the developer MUST state that in their commit message and rely on CI for live coverage. CI MUST run `test:live` for every PR.
  - Success:
    - [ ] `DockerClient` port + `DockerodeAdapter` provide every surface `TomoConnection` will need in Phase 3 `[ref: SDD/TomoConnection Service Surface]`
