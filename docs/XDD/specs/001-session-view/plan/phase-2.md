---
title: "Phase 2: Docker Boundary"
status: completed
version: "1.0"
phase: 2
---

# Phase 2: Docker Boundary

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- PRD: `docs/XDD/specs/001-session-view/requirements.md` — F1 Connect/picker, F9 error categories
- SDD: `docs/XDD/specs/001-session-view/solution.md` — "Docker Helpers (no port — use dockerode directly)", "Integration Points", ADR-1, ADR-5 (revised 2026-04-25), "Implementation Gotchas" (TTY demux)

**Key Decisions** (affecting this phase):
- ADR-1: `dockerode` as the Docker client (constructed with explicit `socketPath`; refuses `DOCKER_HOST`/`DOCKER_CONTEXT`)
- ADR-5 (revised 2026-04-25): No `DockerClient` port; `TomoConnection` calls `dockerode` directly via thin helpers in `src/connection/docker.ts`. Unit tests use `vi.mock('dockerode')`.
- ADR-10: live tests hit real Docker (no mocks at this boundary)

**Dependencies**: Phase 1 complete (types + obsidian mock + deps installed).

---

## Tasks

This phase produces a fully-tested Docker edge that the connection service in Phase 3 consumes. Unit tests use `vi.mock('dockerode')`; live tests exercise dockerode against a running Docker daemon.

- [x] **T2.1 Define `AttachSession` contract + thin dockerode helper module** `[activity: domain-modeling]`

  1. Prime: Read SDD "Docker Helpers (no port — use dockerode directly)" `[ref: SDD/Interface Specifications; Docker Helpers]` and "Integration Points / Docker_Engine". Note: ADR-5 was revised 2026-04-25 to drop the previously-planned `DockerClient` port + `DockerodeAdapter` + `FakeDockerClient` triple — a single production implementation never benefits from a port.
  2. Test: Write `test/unit/connection/docker.test.ts` using `vi.mock('dockerode')`:
     - `listTomoInstances()` (helper) returns instances sorted by `startedAt` desc when dockerode is mocked to return scripted containers
     - `inspectContainer(id)` returns null when dockerode's `getContainer(id).inspect()` rejects with 404
     - `attach(id)` returns an `AttachSession` whose `stdout` emits configured bytes, `stdin` captures writes, `close()` resolves once
  3. Implement: Create `src/connection/docker.ts` exporting `listTomoInstances`, `inspectContainer`, `attach`, and the `AttachSession` interface. Each helper imports `dockerode` directly and constructs `new Dockerode({ socketPath })` with the platform-default socket (no `DOCKER_HOST` follow). No `DockerClient` interface, no adapter class, no fake.
  4. Validate: Unit tests pass; types strict.
  5. Success:
     - [ ] Helper module matches SDD contract; `vi.mock('dockerode')` covers all four helpers `[ref: SDD/Docker Helpers]`
     - [ ] `socketPath` is explicit; env-driven redirection refused `[ref: PRD/F1 Docker socket pinning AC]`

- [x] **T2.2 Live test — discovery against real Docker** `[activity: integration]`

  1. Prime: Read [dockerode docs](https://github.com/apocas/dockerode) on `listContainers({ filters })` and `getContainer(id).inspect()`; review SDD "Docker discovery result mapping" algorithm `[ref: SDD/Runtime View; Complex Logic - Discovery result mapping]`.
  2. Test: Write `test/live/docker-discovery.live.test.ts`:
     - Start a disposable container with labels `miyo.component=tomo` and `miyo.tomo.instance-name=test-a`; call `listTomoInstances()`; expect one instance with name `test-a`
     - Start a second container without the instance-name label; expect two instances, one with `name: null`
     - Start a third container with `miyo.component=tomo`, `miyo.plugin-enabled=false`; **explicitly verify the current scope excludes only the `miyo.component=tomo` filter** (SDD does not filter on `plugin-enabled` — this label is a Tomo-side advisory but not a filter gate in v0.1 per README decisions log 2026-04-24)
     - Cleanup: `docker stop && docker rm` all containers in `afterEach`
  3. Implement: Already in `src/connection/docker.ts` from T2.1 — `listTomoInstances()` calls `dockerode.listContainers({ filters: { label: ['miyo.component=tomo'] } })` and maps to `TomoInstance[]` sorted by `startedAt` desc; `inspectContainer(id)` returns null on 404.
  4. Validate: Live test passes against a real daemon (`npm run test:live`); error paths produce `ConnectionError` with correct `code`.
  5. Success:
     - [ ] Label-scoped discovery works against real Docker `[ref: PRD/F1/AC1; SDD/ADR-1]`
     - [ ] Missing instance-name label → `name: null` graceful fallback `[ref: PRD/F1/AC5]`
     - [ ] Inspect returns null (not throws) for missing containers `[ref: SDD/Docker Helpers]`

- [x] **T2.3 Live test — attach with TTY demux detection** `[activity: integration]`

  1. Prime: Read SDD "Implementation Gotchas / Attach stream demuxing" `[ref: SDD/Implementation Gotchas]` and dockerode's `container.attach({ stream, stdout, stderr, stdin, logs })` docs.
  2. Test: Write `test/live/docker-attach.live.test.ts`:
     - Run `alpine:latest cat` with `tty: true`; attach; write "hello\n" to stdin; expect to receive "hello\n" on stdout within 2 s; close; expect onClose("user")
     - Run `alpine:latest sh -c 'echo out; echo err 1>&2; cat'` with `tty: false`; attach; expect demuxed stdout and stderr frames to arrive separately
     - `close()` must be idempotent: calling twice does not throw
  3. Implement: Already in `src/connection/docker.ts` — `attach(id)` calls `inspectContainer(id)` first to detect `Config.Tty`; opens `container.attach({ stream: true, stdout: true, stderr: true, stdin: true, logs: false })`. When `tty: true`: return the raw Duplex as both stdout and stdin. When `tty: false`: use dockerode's `modem.demuxStream`. `close()` is idempotent and emits `onClose(reason)`.
  4. Validate: Both live-test scenarios pass; close is idempotent; no socket leaks (check `process._getActiveHandles` length returns to baseline).
  5. Success:
     - [ ] Bidirectional stream confirmed end-to-end `[ref: PRD/F4/AC5; SDD/ADR-2]`
     - [ ] TTY and non-TTY containers both supported `[ref: SDD/Implementation Gotchas]`
     - [ ] Clean teardown `[ref: SDD/Deployment View; Rollback]`

- [x] **T2.4 Phase 2 Validation** `[activity: validate]`

  - Run `npm test && npm run test:live`. Unit tests green. Live tests green against a local Docker daemon. Lint clean. Tick Phase 2 checkbox in `plan/README.md`.
  - If `test:live` cannot run (no Docker on dev machine), the developer MUST state that in their commit message and rely on CI for live coverage. CI MUST run `test:live` for every PR.
  - Success:
    - [ ] `src/connection/docker.ts` provides every surface `TomoConnection` will need in Phase 3 `[ref: SDD/TomoConnection Service Surface]`
