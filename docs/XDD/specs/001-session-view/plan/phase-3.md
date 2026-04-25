---
title: "Phase 3: Connection Service"
status: pending
version: "1.0"
phase: 3
---

# Phase 3: Connection Service

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- PRD: F1 Connect, F2 Disconnect, F5 Force Reconnect semantics, F8 Automatic reconnect, FS2 Remember last instance
- SDD: "TomoConnection Service Surface", "Runtime View" (all flows), "Implementation Examples / Reconnect Backoff", "State Store — typed Store<T> helper" subsection
- ADRs: ADR-4 (Store), ADR-7 (reconnect backoff)

**Key Decisions** (affecting this phase):
- ADR-4 (revised 2026-04-25): `connectionStore: Store<ConnectionState>` — single export with `subscribe` + `set`. No read/write split (`connectionStoreWrite` dropped); no `derived<T,U>` helper (subscribers compute slices inline).
- ADR-7: cancellable promise chain, delays `[500, 1000, 2000, 4000, 8000]` ms
- ADR-5 (revised 2026-04-25): All Docker I/O is direct dockerode use via `src/connection/docker.ts` (no `DockerClient` port, no `FakeDockerClient`). Unit tests use `vi.mock('dockerode')`.

**Dependencies**: Phase 1 (types, Store, mock), Phase 2 (DockerClient port).

---

## Tasks

This phase produces the full state machine that the UI subscribes to in Phase 4. Every PRD lifecycle requirement lands here.

- [ ] **T3.1 `connectionStore` + derived slices** `[activity: domain-modeling]`

  1. Prime: Read SDD "State Store — typed Store<T> helper" subsection `[ref: SDD/Interface Specifications; State Store]`.
  2. Test: Write `test/unit/connection/connectionStore.test.ts`:
     - `connectionStore` initial value is `{ kind: "disconnected" }`
     - `displayInstanceName` is `null` when disconnected
     - `displayInstanceName` is `instance.name` when connected; `instance.shortId` when name is null; `target.name ?? target.shortId` when attaching/reconnecting
     - `displayInstanceName(state)` (plain function) computes the right value across all states — no separate derived store.
     - `connectionStore.set(...)` updates the store and fires subscribers; the "only TomoConnection writes" rule is enforced by code review (per ADR-4 v3 — `connectionStoreWrite` was dropped).
  3. Implement: Create `src/connection/connectionStore.ts` per SDD code sketch — export the singleton `connectionStore: Store<ConnectionState>` and the `displayInstanceName(state)` plain function. No `derived`, no `connectionStoreWrite`, no `kind` derived store.
  4. Validate: All unit tests pass; types strict.
  5. Success:
     - [ ] Derived slices match SDD contract exactly `[ref: SDD/State Store]`

- [ ] **T3.2 `ReconnectLoop` with cancellation** `[activity: backend-api]`

  1. Prime: Read SDD "Example: Reconnect Backoff" with both traced walkthroughs — including the cancel-during-wait bug caught in the first sketch `[ref: SDD/Implementation Examples; Reconnect Backoff]`.
  2. Test: Write `test/unit/connection/reconnectLoop.test.ts` using vitest fake timers:
     - Happy: attempt succeeds on 3rd try; total time simulated = 500 + 1000 + 2000 = 3500 ms; loop returns `"success"` after 3 attempts; `onAttempt` called 3 times with correct `(n, delay)` args
     - Exhaustion: attempt always fails; loop runs 5 attempts; total ≈ 15.5 s; returns `"exhausted"`
     - Cancel during wait: cancel during the 500 ms wait; `wait` resolves immediately; loop head sees `cancelled`; returns `"cancelled"`; no further attempts
     - Cancel after attempt: cancel after the attempt rejects but before next wait; returns `"cancelled"`
     - Concurrent cancel + success: if cancel fires after attempt resolves successfully, the success return is preserved (do not overwrite with `"cancelled"`)
  3. Implement: Create `src/connection/reconnectLoop.ts` per SDD code sketch; ensure `cancel()` resolves the pending `wait()` via stored resolve reference.
  4. Validate: All tests pass with fake timers; real-timer smoke test (one attempt, non-cancelled) passes.
  5. Success:
     - [ ] Exact backoff schedule [500, 1000, 2000, 4000, 8000] ms `[ref: PRD/F8/AC2]`
     - [ ] Cancel-during-wait handled correctly `[ref: SDD/Implementation Examples; traced walkthrough]`

- [ ] **T3.3 `TomoConnection` service** `[activity: backend-api]`

  1. Prime: Read SDD "TomoConnection Service Surface" + all four "Runtime View" sequence diagrams `[ref: SDD/TomoConnection Service Surface; SDD/Runtime View]`.
  2. Test: Write `test/unit/connection/TomoConnection.test.ts` using `vi.mock('dockerode')` (per ADR-5 v2 — no `FakeDockerClient`):
     - `openPicker()` returns instances from the fake
     - `connect(instance)` transitions Disconnected → Attaching → Connected; persists `chosenInstanceId`
     - `connect(instance)` on daemon error transitions to Disconnected with `daemon-unreachable`
     - `connect(instance)` on permission error → Disconnected with `socket-permission-denied`
     - `disconnect()` transitions Connected → Disconnected; does NOT stop the container (fake tracks this); idempotent when already disconnected
     - `forceReconnect()` while Connected: closes + reattaches; remains Connected on success
     - `forceReconnect()` when chosen instance is gone: stays Disconnected with `chosen-instance-gone`; does NOT open picker (no picker method called)
     - Stream `close` event while Connected: auto-transitions to Reconnecting; runs backoff; returns to Connected on success; transitions to Disconnected(`reconnect-exhausted`) on exhaustion
     - `autoReconnectIfRemembered()`: if `chosenInstanceId` is set and container exists, auto-reconnects; if container missing, stays Disconnected without opening picker
     - `write()` while Connected: writes to stdin; `onData()` receives stdout chunks
     - `write()` while not Connected: throws
     - `dispose()` unsubscribes and closes any active stream
  3. Implement: Create `src/connection/TomoConnection.ts` with the full state machine; every transition writes via `connectionStore.set(...)`. The class imports dockerode helpers from `./docker` directly.
  4. Validate: All TomoConnection tests pass; ESLint clean; types strict.
  5. Success:
     - [ ] Every lifecycle transition in SDD Runtime View verified `[ref: SDD/Runtime View]`
     - [ ] Picker never auto-opens from non-Settings sources `[ref: PRD/F5/AC4; PRD/F6/AC4-5; README Decisions Log 2026-04-24]`
     - [ ] chosen-instance-gone handled consistently across Force Reconnect, auto-reconnect, palette `[ref: PRD/F5/AC4; PRD/F6/AC4]`

- [ ] **T3.4 Plugin-data persistence helper** `[activity: data-architecture]`

  1. Prime: Read SDD "Data Storage Changes" `[ref: SDD/Data Storage Changes]` and FS2 in PRD.
  2. Test: Write `test/unit/connection/settingsPersistence.test.ts`:
     - `loadSettings(plugin)` returns `DEFAULT_SETTINGS` when plugin has no data
     - `loadSettings(plugin)` merges persisted data over defaults
     - `saveSettings(plugin, settings)` calls `saveData` with the provided object
     - Interaction with TomoConnection: on successful connect, `chosenInstanceId` persists; on disconnect, `chosenInstanceId` persists (not cleared — autoReconnect will try again next launch) — verify the exact FS2 semantics
  3. Implement:
     - Add `loadSettings` / `saveSettings` helpers in `src/connection/settingsPersistence.ts` (wraps `plugin.loadData` / `plugin.saveData`)
     - Wire `TomoConnection.connect()` to call `saveSettings` on successful Connected transition
     - Leave `chosenInstanceId` in place after Disconnect — the user explicitly chose this instance, and FS2 says "remember last connected" not "remember currently connected"
  4. Validate: Tests pass; persistence verified.
  5. Success:
     - [ ] `chosenInstanceId` survives plugin reload `[ref: PRD/FS2/AC1]`
     - [ ] Missing remembered container → Disconnected with `chosen-instance-gone`, picker NOT opened `[ref: PRD/FS2/AC2]`

- [ ] **T3.5 Phase 3 Validation** `[activity: validate]`

  - Run `npm test`. Verify all state-machine unit tests pass. Add a short integration exercise in `test/unit/connection/serviceIntegration.test.ts` wiring `TomoConnection` + `connectionStore`: subscribe to `connectionStore`, drive the service through a full lifecycle (connect → stream-error → reconnect → disconnect), assert every observed state transition in order.
  - Success:
    - [ ] Full state machine observable from `connectionStore` subscribers `[ref: SDD/Solution Strategy; single source of truth]`
    - [ ] Lint clean; types strict `[ref: src/CLAUDE.md]`
