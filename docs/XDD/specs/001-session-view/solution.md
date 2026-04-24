---
title: "Tomo Connection & Chat Window — Solution Design"
status: draft
version: "1.0"
---

# Solution Design Document

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All required sections are complete
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Architecture pattern is clearly stated with rationale
- [x] **All architecture decisions confirmed by user** — 10/10 confirmed (ADR-1, ADR-2 in brainstorm; ADR-3..ADR-10 in ADR batch round)
- [x] Every interface has specification

### QUALITY CHECKS (Should Pass)

- [x] All context sources listed with relevance ratings
- [x] Project commands discovered from actual project files
- [x] Constraints → Strategy → Design → Implementation path is logical
- [x] Every component in diagram has directory mapping
- [x] Error handling covers all error types
- [x] Quality requirements are specific and measurable
- [x] Component names consistent across diagrams
- [x] A developer could implement from this design
- [x] Examples use real TypeScript types (not pseudocode)
- [x] Complex flows include traced walkthroughs

---

## Output Schema

### SDD Status Report

| Field | Value |
|-------|-------|
| specId | 001-session-view |
| architecture.pattern | Layered plugin with singleton connection service and event-subscribed UI |
| architecture.keyComponents | TomoConnection service, DockerClient, TomoChatView (ItemView), StatusBarIcon, SettingsTab, InstancePickerModal, FileMenuHandler, CommandRegistry, Store helper |
| architecture.externalIntegrations | Docker Engine API (local socket), Obsidian Plugin API |
| adrs | 10 (all confirmed) |

### Section Status

| Section | Status | Detail |
|---------|--------|--------|
| Constraints | COMPLETE | |
| Implementation Context | COMPLETE | |
| Solution Strategy | COMPLETE | |
| Building Block View | COMPLETE | |
| Interface Specifications | COMPLETE | |
| Runtime View | COMPLETE | |
| Deployment View | COMPLETE | |
| Cross-Cutting Concepts | COMPLETE | |
| Architecture Decisions | COMPLETE | All 10 ADRs confirmed |
| Quality Requirements | COMPLETE | |
| Acceptance Criteria | COMPLETE | |
| Risks and Technical Debt | COMPLETE | |
| Glossary | COMPLETE | |

---

## Constraints

CON-1 **Platform**: Obsidian Desktop (Electron). TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. Target ES2018 (per `esbuild.config.mjs`). `lib: ["DOM", "ES5", "ES6", "ES7"]` (per `tsconfig.json`). Runtime has full Node.js built-ins plus DOM — we can use `net`, `http`, `stream`, and `process`.
CON-2 **Build**: esbuild with CommonJS output bundled to `main.js`. Externals list excludes `obsidian` and node builtins. xterm.js requires a CSS loader (for `@xterm/xterm/css/xterm.css`). No template/component preprocessor needed — plain TS compiles directly.
CON-3 **Desktop-only enforcement**: `manifest.json` must flip `isDesktopOnly: false → true`. Currently drift (PRD constraint); SDD allocates it to the plan's initial phase.
CON-4 **Testing**: vitest with two configs — unit (`vitest.config.ts`, jsdom, obsidian mock) and live (`vitest.live.config.ts`, node, real Docker). Team feedback memory: **no mocks for the Docker boundary in integration tests** — live tests must hit a real daemon.
CON-5 **No external inbound surface**: no ports, no webhooks, no MCP server. All code runs in-process with the Obsidian plugin.
CON-6 **One connection, one chat view**: enforced at the service layer (connection) and workspace layer (singleton Leaf lookup).
CON-7 **Bundle budget**: informal target ≤ 500 KB minified for `main.js`. xterm.js (~150 KB) + dockerode (~80 KB) + Svelte runtime (~10 KB) + app code fits comfortably.
CON-8 **Trust boundary**: all bytes from the container are untrusted text. xterm.js handles them as terminal text — no HTML rendering, no URI handling from stream output.
CON-9 **Tomo handoff dependency**: picker labels and reconnect-command label benefit from Tomo exposing an instance-name Docker label (`miyo.tomo.instance-name=<name>`). PRD mandates graceful fallback if missing; SDD must implement fallback as first-class behavior, not an error path.

## Implementation Context

**IMPORTANT**: The following context sources MUST be read and understood before implementing any component.

### Required Context Sources

#### Documentation Context
```yaml
- doc: docs/XDD/specs/001-session-view/requirements.md
  relevance: CRITICAL
  why: "PRD — every requirement must map to an SDD component or ADR"

- doc: docs/XDD/specs/001-session-view/README.md
  relevance: HIGH
  why: "Scope boundaries and Decisions Log — captures every product decision the SDD must honor"

- doc: docs/XDD/specs/002-instruction-executor/README.md
  relevance: MEDIUM
  why: "Sister spec; confirms 002 is decoupled from 001 — the SDD must not expose shared state to 002"

- doc: src/CLAUDE.md
  relevance: HIGH
  why: "TDD rules — RED/GREEN/REFACTOR; no impl before a failing test"

- doc: test/CLAUDE.md
  relevance: HIGH
  why: "Test naming conventions, coverage expectations, fixture isolation"

- url: https://github.com/apocas/dockerode
  relevance: CRITICAL
  why: "Docker client library — attach API semantics, stream hijack protocol, demuxing stdout/stderr"

- url: https://xtermjs.org/docs/
  relevance: HIGH
  why: "Terminal rendering — lifecycle, addons (fit), DOM binding"

- url: https://docs.obsidian.md/Plugins/
  relevance: HIGH
  why: "Plugin API — ItemView, WorkspaceLeaf singleton patterns, addStatusBarItem, addCommand, Menu, PluginSettingTab"

```

#### Code Context
```yaml
- file: src/main.ts
  relevance: CRITICAL
  why: "Plugin entry point — lifecycle hooks (onload/onunload) where the connection service, chat view, status bar, commands, and file menu handler are wired"

- file: src/settings/SettingsTab.ts
  relevance: HIGH
  why: "Will be rewritten to build Connect/Disconnect UI directly in `display()` using Obsidian's native `Setting` API"

- file: src/types/index.ts
  relevance: HIGH
  why: "Will be expanded — PluginSettings gets chosenInstanceId; domain types (ConnectionState, TomoInstance) added or moved to dedicated modules"

- file: esbuild.config.mjs
  relevance: HIGH
  why: "Build config — must add a loader for xterm.css; no preprocessor plugin needed for plain TS"

- file: tsconfig.json
  relevance: HIGH
  why: "Strict mode constraints; baseUrl='src' allows bare imports like `connection/TomoConnection`"

- file: manifest.json
  relevance: CRITICAL
  why: "`isDesktopOnly: false` MUST flip to `true` per PRD constraint"

- file: package.json
  relevance: HIGH
  why: "Runtime deps to add: dockerode, @xterm/xterm, @xterm/addon-fit. DevDeps to add: @types/dockerode"

- file: test/__mocks__/obsidian.ts
  relevance: HIGH
  why: "Mock must be extended — ItemView, WorkspaceLeaf, Menu, Events/EventRef; add as needed during implementation"

- file: vitest.config.ts + vitest.live.config.ts
  relevance: HIGH
  why: "Two test surfaces — unit (mocked obsidian) and live (real Docker). Connection service unit-tested; docker attach live-tested."
```

#### External APIs
```yaml
- service: Docker Engine API
  doc: https://docs.docker.com/engine/api/v1.45/
  relevance: HIGH
  why: "Endpoints used: GET /containers/json?filters={label: miyo.component=tomo}, POST /containers/{id}/attach?stream=1&stdout=1&stderr=1&stdin=1&logs=0, GET /containers/{id}/json (inspect for labels/started-at). Accessed via dockerode, not raw HTTP."

- service: Obsidian Plugin API
  doc: https://docs.obsidian.md/Reference/TypeScript+API/
  relevance: HIGH
  why: "WorkspaceLeaf, ItemView, PluginSettingTab, addStatusBarItem, addCommand (incl. removeCommand for dynamic relabeling), Menu, Notice, registerEvent('file-menu')"
```

### Implementation Boundaries
- **Must Preserve**: `main.ts` plugin class default export; ESLint config; esbuild output layout (`main.js` + `manifest.json` + `styles.css`); the fact that integration tests hit real Docker, no mocks at that boundary.
- **Can Modify**: Everything under `src/` (scaffold placeholders); `manifest.json` `isDesktopOnly` flag; `esbuild.config.mjs` (add Svelte plugin + CSS loader); `package.json` deps.
- **Must Not Touch**: `_outbox/`, `_inbox/`, `.githooks/`, `claude-docker/`, Obsidian's own plugins in `test/Hashi/.obsidian/plugins/hot-reload/`. The `miyo-kouzou` repo is never modified from a Hashi session (see Kouzou git-ops rule in `~/Kouzou/standards/general.md`).

### External Interfaces

#### System Context Diagram

```mermaid
graph TB
    User[PKM Author]
    Obsidian[Obsidian Desktop]
    Hashi[Hashi Plugin]
    Docker[Local Docker Daemon<br/>Unix socket / named pipe]
    Tomo[Tomo Container<br/>PID 1: claude]
    Vault[(Obsidian Vault<br/>filesystem)]

    User -->|Clicks Connect in Settings| Hashi
    User -->|Types in chat view| Hashi
    User -->|Right-clicks a file| Hashi
    User -->|Hovers/clicks status bar icon| Hashi
    User -->|Invokes palette command| Hashi

    Hashi -->|Registers views, commands,<br/>status bar item, file menu| Obsidian
    Obsidian -->|Events: layout-ready, file-menu,<br/>workspace.on| Hashi

    Hashi -->|List containers by label,<br/>attach to PID 1, inspect| Docker
    Docker -->|Bidirectional stdio stream<br/>ANSI/UTF-8 bytes| Hashi
    Docker -->|Hosts| Tomo

    Hashi -->|Reads `@vault/path` refs<br/>from file explorer| Vault
    Hashi -->|Persists chosenInstanceId<br/>via loadData/saveData| Vault
```

#### Interface Specifications

```yaml
inbound:
  - name: "User → Settings Tab"
    type: Obsidian PluginSettingTab
    format: DOM events (click, focus)
    authentication: Trusted (plugin owner)
    data_flow: "Connect/Disconnect clicks; picker selection"

  - name: "User → Command Palette"
    type: Obsidian Command (via addCommand)
    format: Command invocation callback
    authentication: Trusted
    data_flow: "Reconnect, Show chat window"

  - name: "User → Status Bar Icon"
    type: HTMLElement click/hover on addStatusBarItem
    format: DOM events
    authentication: Trusted
    data_flow: "Hover → tooltip render; click → Menu popover"

  - name: "User → File Explorer Context Menu"
    type: Obsidian 'file-menu' workspace event
    format: Menu item callback with TFile argument
    authentication: Trusted
    data_flow: "Right-click on any file → insert/open chat with @file"

  - name: "User → Chat View"
    type: Obsidian ItemView
    format: DOM events in chat input; terminal keyboard events routed to xterm
    authentication: Trusted
    data_flow: "Chat input keystrokes → Docker stdin"

outbound:
  - name: "Docker Engine API"
    type: Unix domain socket (macOS: Docker Desktop socket; Linux: /var/run/docker.sock; Windows: \\.\pipe\docker_engine)
    format: HTTP over socket (dockerode handles protocol + stream hijack)
    authentication: OS file permissions (user must have socket access)
    criticality: HIGH
    data_flow: "List containers with label filter; attach to container stdio; inspect for metadata"

  - name: "Obsidian Persistence"
    type: Plugin loadData/saveData
    format: JSON blob (PluginSettings)
    authentication: Sandboxed to plugin
    criticality: LOW
    data_flow: "Persist chosenInstanceId (FS2) across Obsidian launches"

data:
  - name: "Obsidian Vault (filesystem)"
    type: Not directly accessed by 001 beyond reading file paths (read-only; spec 002 does the vault writes)
    connection: Obsidian Plugin API (app.vault)
    data_flow: "File-menu handler receives TFile; we only read its path (`file.path`) to build the `@`-mention. No content is read."
```

### Cross-Component Boundaries

- **API Contract (internal, 001 ↔ 002)**: **None.** Per PRD brainstorm pivot, spec 002 runs standalone. The only shared artifact is the Tomo Docker label contract (`miyo.component=tomo`, `miyo.tomo.instance-name=...`), and even that is consumed only by 001.
- **Shared Resources**: `src/types/index.ts` may hold plugin-wide settings types; 002 will add its own types in a sibling module. No shared state.
- **Breaking Change Policy**: 001's internal modules are not public — no external consumer. Breaking changes within 001 are free until release.

### Project Commands

```bash
# Discovered from package.json
Install: npm install
Dev:     npm run dev          # esbuild watch mode (unbundled, inline sourcemap)
Build:   npm run build        # tsc --noEmit + esbuild production
Test:    npm test             # vitest unit (jsdom, obsidian mock)
Test-watch: npm run test:watch
Coverage: npm run test:coverage
Test-live: npm run test:live  # vitest live (node env, REAL Docker, 90s timeout)
Lint:    npm run lint         # ESLint with obsidianmd rules
```

## Solution Strategy

- **Architecture Pattern**: **Layered plugin with singleton connection service and event-subscribed UI**. One `TomoConnection` singleton owns all Docker I/O and state; every UI surface (Settings, status bar, chat view, commands) subscribes to a typed `Store<ConnectionState>` helper that mirrors the service state; the file menu handler and command registry are thin shims over the service.
- **Integration Approach**: All Docker work happens in the connection service. UI layers are pure state consumers — they do not call dockerode directly and do not hold connection state themselves. This keeps reconnect logic, backoff, and state transitions in one place.
- **Justification**: One connection → one source of truth. Multi-surface UI (Settings + status bar + chat view + palette command label) demands a shared reactive state. A small typed `Store<T>` helper (~30 LOC) is sufficient for the few reactive surfaces involved — no framework runtime needed. Keeping Docker I/O isolated makes the code testable (service unit-tested with a mockable `DockerClient` port; real Docker reached only in `test:live`).
- **Key Decisions** (full rationale in Architecture Decisions section):
  - ADR-1 Docker client = **dockerode** (confirmed)
  - ADR-2 Attach mechanism = **`docker attach` to PID 1 + xterm.js** (confirmed)
  - ADR-3 UI approach = **Plain TypeScript + DOM via Obsidian primitives** (confirmed)
  - ADR-4 State store = **Custom typed `Store<T>` helper** (confirmed)
  - ADR-5 Layer boundary = **Ports & adapters at the Docker edge** (confirmed)
  - ADR-6 Singleton view management = **Obsidian `getLeavesOfType` + `setViewState`** (confirmed)
  - ADR-7 Reconnect backoff = **Cancellable promise-chain with explicit delays** (confirmed)
  - ADR-8 Dynamic command label = **`removeCommand` + `addCommand` on state change** (confirmed)
  - ADR-9 Status bar popover = **Obsidian `Menu` API** (confirmed)
  - ADR-10 Test split = **vitest unit for state/logic; vitest live for Docker** (confirmed)

## Building Block View

### Components

```mermaid
graph TB
    subgraph Obsidian[Obsidian Plugin Host]
        Main[main.ts<br/>HashiPlugin]
        StatusBar[StatusBarIcon]
        ChatView[TomoChatView : ItemView]
        SettingsUI[SettingsTab : PluginSettingTab]
        Picker[InstancePickerModal : Modal]
        FileMenu[FileMenuHandler]
        Commands[CommandRegistry]
    end

    subgraph Core[Core services]
        Store["connectionStore :<br/>Store&lt;ConnectionState&gt;"]
        Service[TomoConnection<br/>service]
        Client[DockerClient<br/>port + dockerode adapter]
    end

    Main -->|wires| StatusBar
    Main -->|wires| ChatView
    Main -->|wires| SettingsUI
    Main -->|wires| FileMenu
    Main -->|wires| Commands
    Main -->|owns| Service

    StatusBar -->|subscribe| Store
    ChatView -->|subscribe| Store
    SettingsUI -->|subscribe; opens| Picker
    SettingsUI -->|invoke connect/disconnect| Service
    Picker -->|selection| Service
    Commands -->|subscribe for label; invoke reconnect/showView| Store

    Service -->|publishes state| Store
    Service -->|Docker calls| Client
    Client -->|HTTP over socket| Docker[(Docker daemon)]

    ChatView -->|write stdin;<br/>onData stdout| Service
```

### Directory Map

```
.
├── src/
│   ├── main.ts                              # MODIFY: plugin entry; wire everything on onload
│   ├── types/
│   │   └── index.ts                         # MODIFY: PluginSettings (chosenInstanceId)
│   ├── connection/                          # NEW: core service + types
│   │   ├── TomoConnection.ts                # NEW: the service (state machine, reconnect orchestration, stream plumbing)
│   │   ├── connectionStore.ts               # NEW: `Store<ConnectionState>` instance + derived slices (displayInstanceName, kind)
│   │   ├── state.ts                         # NEW: ConnectionState discriminated union + transition helpers
│   │   ├── reconnectLoop.ts                 # NEW: cancellable backoff loop (extracted from service for testability)
│   │   └── types.ts                         # NEW: TomoInstance, ConnectionError
│   ├── docker/                              # NEW: Docker boundary (port + adapter)
│   │   ├── DockerClient.ts                  # NEW: port interface (for test substitution); AttachSession contract
│   │   └── DockerodeAdapter.ts              # NEW: real impl using dockerode; TTY demux detection
│   ├── ui/
│   │   ├── chat-view/
│   │   │   ├── TomoChatView.ts              # NEW: Obsidian ItemView subclass; builds DOM in onOpen; owns xterm.js instance; subscribes to connectionStore
│   │   │   ├── terminalHost.ts              # NEW: xterm.js lifecycle helper (init, write, resize, dispose)
│   │   │   └── index.ts                     # NEW: VIEW_TYPE_TOMO_CHAT constant + export of TomoChatView
│   │   ├── status-bar/
│   │   │   ├── StatusBarIcon.ts             # NEW: registers status bar item; renders Tomo-kanji icon + hover tooltip; opens popover on click; subscribes to connectionStore
│   │   │   └── openPopover.ts               # NEW: builds Obsidian `Menu` with 3 actions
│   │   └── settings/
│   │       ├── SettingsTab.ts               # MODIFY: Connect/Disconnect UI built directly in display() with Obsidian `Setting` API; subscribes to connectionStore for live state
│   │       └── InstancePickerModal.ts       # NEW: Obsidian `Modal` subclass listing candidates (name + uptime rows); resolves on selection
│   ├── commands/
│   │   ├── registerCommands.ts              # NEW: addCommand() for 3 Hashi commands + dynamic relabel of Reconnect (removeCommand/addCommand on state change)
│   │   └── fileMenu.ts                      # NEW: registerEvent('file-menu') → inject @file action
│   └── util/
│       ├── store.ts                         # NEW: `Store<T>` and `derived<T,U>` — ~30 LOC typed observable helper
│       ├── time.ts                          # NEW: formatUptime(startedAt) → "3 min ago"
│       └── logger.ts                        # NEW: thin console.debug wrapper tagged with [miyo-tomo-hashi]
├── test/
│   ├── unit/
│   │   ├── connection/
│   │   │   ├── TomoConnection.test.ts       # NEW
│   │   │   ├── state.test.ts                # NEW (transition table)
│   │   │   └── reconnectLoop.test.ts        # NEW (incl. cancel-during-wait case traced in this SDD)
│   │   ├── commands/
│   │   │   └── registerCommands.test.ts     # NEW (dynamic label re-register)
│   │   ├── util/
│   │   │   ├── store.test.ts                # NEW (subscribe/unsubscribe; identity equality; derived)
│   │   │   └── time.test.ts                 # NEW
│   │   └── ui/
│   │       └── status-bar/
│   │           └── openPopover.test.ts      # NEW (popover action routing; disabled tooltip)
│   ├── live/                                # Run via `npm run test:live`; hits real Docker
│   │   ├── attach.live.test.ts              # NEW: attach to a disposable `alpine:latest` running `cat` to echo stdio
│   │   └── discovery.live.test.ts           # NEW: list containers by label; multi-candidate case
│   └── __mocks__/
│       └── obsidian.ts                      # MODIFY: extend with ItemView, WorkspaceLeaf, Menu, Modal, EventRef stubs
├── esbuild.config.mjs                       # MODIFY: add CSS loader for @xterm/xterm/css/xterm.css
├── manifest.json                            # MODIFY: isDesktopOnly: true
├── package.json                             # MODIFY: add runtime deps (dockerode, @xterm/xterm, @xterm/addon-fit) + devDeps (@types/dockerode)
└── styles.css                               # MODIFY: add minimal rules for chat view, status bar indicator, banner
```

### Interface Specifications

#### Application Data Models

```typescript
// src/connection/state.ts
export type ConnectionState =
  | { kind: "disconnected"; reason?: ConnectionError }
  | { kind: "attaching"; target: TomoInstance }
  | { kind: "connected"; instance: TomoInstance }
  | { kind: "reconnecting"; target: TomoInstance; attempt: number; nextDelayMs: number }
  | { kind: "error"; error: ConnectionError; lastKnown?: TomoInstance };

// src/connection/types.ts
export interface TomoInstance {
  readonly containerId: string;       // full Docker container ID
  readonly shortId: string;           // first 12 chars (display)
  readonly name: string | null;       // from label miyo.tomo.instance-name; null if absent
  readonly startedAt: Date;           // from container inspect State.StartedAt
  readonly image: string;             // image reference (for diagnostic tooltip only)
}

export type ConnectionError =
  | { code: "daemon-unreachable"; detail: string }
  | { code: "socket-permission-denied"; detail: string }
  | { code: "no-instances"; detail: "No Tomo instance seems to be running — start one and try again." }
  | { code: "chosen-instance-gone"; containerId: string; detail: string }
  | { code: "stream-error"; detail: string }
  | { code: "picker-cancelled" }                        // user dismissed picker
  | { code: "reconnect-exhausted"; attempts: number };

// src/types/index.ts (extended)
export interface PluginSettings {
  chosenInstanceId: string | null;    // full container ID; null if never connected
}
export const DEFAULT_SETTINGS: PluginSettings = { chosenInstanceId: null };
```

#### Docker Client Port (port/adapter pattern)

```typescript
// src/docker/DockerClient.ts (port)
export interface DockerClient {
  listTomoInstances(): Promise<TomoInstance[]>;
  attach(containerId: string): Promise<AttachSession>;
  inspect(containerId: string): Promise<TomoInstance | null>;  // null if not found
}

export interface AttachSession {
  readonly stdout: NodeJS.ReadableStream;   // demuxed text stream (dockerode handles TTY frame demux when TTY=true)
  readonly stdin: NodeJS.WritableStream;
  close(): Promise<void>;                   // graceful half-close
  onClose(cb: (reason: "user" | "remote" | "error") => void): void;
}
```

**Why a port**: unit tests inject a `FakeDockerClient` that returns scripted results; live tests exercise the real `DockerodeAdapter` against a real daemon (team standard: no Docker mocks in integration tests). Keeps the state machine testable without spinning up containers.

#### TomoConnection Service Surface

```typescript
// src/connection/TomoConnection.ts
export class TomoConnection {
  constructor(private client: DockerClient, private settings: PluginSettings);

  // State access
  get state(): ConnectionState;                // current snapshot

  // User-driven actions
  async openPicker(): Promise<TomoInstance[]>;    // lists candidates (Settings calls this)
  async connect(target: TomoInstance): Promise<void>;  // after picker selection
  async disconnect(): Promise<void>;              // Settings Disconnect
  async forceReconnect(): Promise<void>;          // chat view / palette / status bar popover;
                                                  // NEVER opens picker; stays disconnected on instance-gone

  // Lifecycle
  async autoReconnectIfRemembered(): Promise<void>;  // called once on plugin load
  dispose(): Promise<void>;                          // called from plugin onunload

  // Stream plumbing (chat view uses)
  write(data: string): void;                      // to stdin; throws if not connected
  onData(cb: (chunk: Uint8Array) => void): Disposable;  // from container stdout

  // Dynamic label helper (command registry subscribes)
  get instanceName(): string | null;              // from state; for command palette label
}
```

#### State Store (typed Store<T> helper)

```typescript
// src/util/store.ts  — ~30 LOC, zero deps
export interface Readable<T> {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;   // returns unsubscribe
}

export class Store<T> implements Readable<T> {
  private listeners = new Set<(value: T) => void>();
  constructor(private value: T) {}

  get(): T { return this.value; }

  set(next: T): void {
    if (Object.is(this.value, next)) return;               // identity-based dedup
    this.value = next;
    for (const listener of this.listeners) listener(next);
  }

  subscribe(listener: (value: T) => void): () => void {
    listener(this.value);                                  // fire immediately, matches Svelte/Obsidian conventions
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

export function derived<T, U>(source: Readable<T>, fn: (value: T) => U): Readable<U> {
  const d = new Store(fn(source.get()));
  source.subscribe((v) => d.set(fn(v)));
  return d;
}
```

```typescript
// src/connection/connectionStore.ts
import { Store, derived, type Readable } from "util/store";
import type { ConnectionState } from "./state";

// Singleton, created once at module load; written to only by TomoConnection.
// Re-export as Readable<ConnectionState> to signal intended read-only consumption.
const internalStore = new Store<ConnectionState>({ kind: "disconnected" });
export const connectionStore: Readable<ConnectionState> = internalStore;

// TomoConnection imports this write handle directly; no other module should.
export const connectionStoreWrite: { set: (state: ConnectionState) => void } = {
  set: (s) => internalStore.set(s),
};

// Derived slices — each UI surface reads the narrowest one it needs
export const kind: Readable<ConnectionState["kind"]> = derived(connectionStore, (s) => s.kind);
export const displayInstanceName: Readable<string | null> = derived(connectionStore, (s) => {
  if (s.kind === "connected") return s.instance.name ?? s.instance.shortId;
  if (s.kind === "reconnecting" || s.kind === "attaching") return s.target.name ?? s.target.shortId;
  return null;
});
```

**Write discipline**: `connectionStore` is exported as `Readable<T>` (no `set`). The write handle (`connectionStoreWrite`) is a separate named export intended only for `TomoConnection`. This is still a convention (anyone can import the write handle) but the naming makes misuse obvious in code review. The alternative of a fully-sealed store with a closure-scoped writer adds ceremony without meaningful safety gain at this project size.

**Subscribe-fires-immediately** matches how Obsidian consumers expect state: a subscriber that registers mid-session should render the current state instantly, not wait for the next change. It also aligns with `plugin.register(unsubscribe)` — the unsubscribe is returned directly and teardown is automatic on plugin unload.

#### Data Storage Changes

```yaml
# Plugin data (Obsidian loadData/saveData)
PluginSettings:
  + chosenInstanceId: string | null    # full container ID; persisted on successful connect; cleared on user Disconnect
```

No vault file writes. No new Obsidian settings beyond `chosenInstanceId`.

#### Internal API Changes

Not applicable — no HTTP/RPC endpoints; all integration is in-process function calls through `TomoConnection` and Svelte stores.

#### Integration Points

```yaml
# Docker Engine API (via dockerode)
Docker_Engine:
  - doc: https://docs.docker.com/engine/api/v1.45/
  - ops_used:
      list_containers: GET /containers/json?filters={"label":["miyo.component=tomo"]}
      inspect: GET /containers/{id}/json
      attach: POST /containers/{id}/attach?stream=1&stdout=1&stderr=1&stdin=1&logs=0&tty=1
  - integration: "dockerode wraps each op; attach returns a node Duplex on which reads are TTY-framed (when tty=true in run-time config) or multiplexed frames (when tty=false). Tomo containers are expected to run with tty=true (claude is a TUI); dockerode demuxes accordingly. If the container was started without tty, we receive multiplexed frames and dockerode exposes `modem.demuxStream()` — the adapter handles both cases."
  - critical_data: container labels, container id, started_at timestamp

# Obsidian Plugin API (in-process)
Obsidian:
  - doc: https://docs.obsidian.md/Reference/TypeScript+API/
  - ops_used:
      Plugin.onload / onunload / loadData / saveData
      Plugin.addStatusBarItem()
      Plugin.addCommand() / removeCommand()       # removeCommand supports dynamic relabel
      Plugin.addSettingTab()
      Plugin.registerView(VIEW_TYPE_TOMO_CHAT, leaf => new TomoChatView(leaf, plugin))
      Plugin.registerEvent(app.workspace.on('file-menu', handler))
      app.workspace.getLeavesOfType(VIEW_TYPE_TOMO_CHAT)   # singleton lookup
      app.workspace.getRightLeaf(false) / getLeaf('tab')   # placement
      app.workspace.setActiveLeaf()
      Menu (for status bar popover)
      Notice (for pre-view errors when chat view is closed)
      PluginSettingTab
```

### Implementation Examples

#### Example: Reconnect Backoff

**Why this example**: PRD Feature F8 mandates 5 attempts with exponential backoff (500 ms, 1 s, 2 s, 4 s, 8 s). The non-obvious part is cancellation — the user can trigger Disconnect or Force Reconnect mid-backoff, and the pending delay must cancel cleanly without firing a late retry.

```typescript
// src/connection/reconnectBackoff.ts (conceptual — actual code may refactor further)
const DELAYS_MS = [500, 1000, 2000, 4000, 8000] as const;

export class ReconnectLoop {
  private cancelled = false;
  private currentTimer: NodeJS.Timeout | null = null;

  async run(
    attempt: (attemptNumber: number) => Promise<boolean>,   // returns true on success
    onAttempt: (attemptNumber: number, nextDelayMs: number) => void,
  ): Promise<"success" | "exhausted" | "cancelled"> {
    for (let i = 0; i < DELAYS_MS.length; i++) {
      if (this.cancelled) return "cancelled";
      const delay = DELAYS_MS[i]!;                            // non-null per noUncheckedIndexedAccess; bounded loop
      onAttempt(i + 1, delay);
      await this.wait(delay);
      if (this.cancelled) return "cancelled";
      const ok = await attempt(i + 1);
      if (ok) return "success";
    }
    return "exhausted";
  }

  cancel(): void {
    this.cancelled = true;
    if (this.currentTimer) { clearTimeout(this.currentTimer); this.currentTimer = null; }
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => {
      this.currentTimer = setTimeout(() => { this.currentTimer = null; resolve(); }, ms);
    });
  }
}
```

**Traced walkthrough** (reconnect succeeds on attempt 3):
- t=0 ms: `run()` called. `onAttempt(1, 500)` fires. `wait(500)`.
- t=500 ms: `attempt(1)` → Docker rejects (stream not yet up). Returns `false`. Loop continues.
- t=500 ms: `onAttempt(2, 1000)`. `wait(1000)`.
- t=1500 ms: `attempt(2)` → `false`.
- t=1500 ms: `onAttempt(3, 2000)`. `wait(2000)`.
- t=3500 ms: `attempt(3)` → `true`. Return `"success"`. No further attempts.

**Traced walkthrough** (user cancels during backoff):
- t=0 ms: `run()` called. `onAttempt(1, 500)`. `wait(500)`.
- t=200 ms: user clicks Disconnect. `cancel()` fires. `clearTimeout`. `cancelled = true`.
- t=200 ms: the `wait(500)` promise never resolves (we cleared the timer before it fired). Wait — that's a resource leak. Fix: `cancel()` must also resolve the pending `wait()`. Adjusted implementation:

```typescript
private wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    this.currentTimer = setTimeout(() => { this.currentTimer = null; resolve(); }, ms);
    // cancel() sets cancelled=true and the next check at loop head bails out.
    // To resolve the pending wait immediately on cancel, store `resolve` and call it in cancel().
  });
}
```

This trace caught a real bug in the first sketch. The final implementation stores `resolve` and calls it from `cancel()` so the loop head check runs immediately. Tests must cover this explicitly.

**Edge cases**:
- Cancel fires after `attempt()` resolves but before the loop iterates — the `cancelled` check at loop head covers this.
- Multiple concurrent `run()` calls — `ReconnectLoop` is per-reconnect-session; `TomoConnection` creates a fresh instance each time it enters Reconnecting state, and cancels the prior one.
- Network-gone and recovered mid-backoff — attempt returns `false`, loop continues normally; no special handling needed.

#### Example: Dynamic Command Label

**Why this example**: Obsidian's command registry does not natively support renaming a registered command. PRD F6 requires the palette to show "Tomo Hashi: Reconnect to `<instance-name>`" with the name pulled from state. We implement this with `removeCommand` + `addCommand` on every state change where the display name would differ.

```typescript
// src/commands/registerCommands.ts
import type { Plugin } from "obsidian";
import { displayInstanceName } from "connection/connectionStore";

export function registerReconnectCommand(plugin: Plugin, onInvoke: () => Promise<void>): void {
  const RECONNECT_ID = "reconnect-to-tomo";
  let currentLabel = "";

  const install = (name: string | null): void => {
    const label = name ? `Reconnect to ${name}` : "Reconnect to Tomo";
    if (label === currentLabel) return;
    if (currentLabel) plugin.removeCommand(RECONNECT_ID);
    plugin.addCommand({ id: RECONNECT_ID, name: label, callback: onInvoke });
    currentLabel = label;
  };

  // subscribe() fires immediately with the current value AND on every change.
  // It returns the unsubscribe; plugin.register() calls it on plugin unload.
  plugin.register(displayInstanceName.subscribe((name) => install(name)));
}
```

**Note**: Obsidian prefixes commands with the plugin's `name` from `manifest.json` automatically, so the user sees "MiYo Tomo Hashi: Reconnect to `<name>`". The `name:` in `addCommand` is the suffix only.

`plugin.register(cleanupFn)` is Obsidian's teardown registration — the subscribe's unsubscribe function runs on plugin unload.

## Runtime View

### Primary Flow — Connect (from Settings)

```mermaid
sequenceDiagram
    actor User
    participant S as SettingsPane.svelte
    participant C as TomoConnection
    participant D as DockerClient (dockerode)
    participant Docker

    User->>S: Click Connect
    S->>C: openPicker()
    C->>D: listTomoInstances()
    D->>Docker: GET /containers/json?filters
    Docker-->>D: [ {id, labels, StartedAt, Image}, ... ]
    D-->>C: TomoInstance[]
    C-->>S: TomoInstance[]
    S->>User: Render picker (name + uptime)
    User->>S: Select instance
    S->>C: connect(instance)
    Note over C: state → attaching
    C->>D: attach(containerId)
    D->>Docker: POST /containers/{id}/attach?tty=1
    Docker-->>D: Duplex stream (stdio)
    D-->>C: AttachSession
    Note over C: state → connected; persist chosenInstanceId
    C->>S: state change (via store)
```

### Primary Flow — Chat Message Send

```mermaid
sequenceDiagram
    actor User
    participant V as ChatView.svelte
    participant T as Terminal.svelte (xterm)
    participant C as TomoConnection
    participant Docker

    User->>V: Type message + Enter
    V->>C: write("user text\n")
    C->>Docker: stdin (via attach stream)
    Docker-->>C: stdout bytes (streaming)
    C-->>T: onData(chunk)
    T->>T: xterm.write(chunk)
    T-->>User: Rendered output
```

### Failure Flow — Transient Disconnect → Auto Reconnect → Success

```mermaid
sequenceDiagram
    participant C as TomoConnection
    participant R as ReconnectLoop
    participant D as DockerClient
    participant Store as connectionStore

    Note over C: state=connected; stream error event
    C->>Store: state = reconnecting(attempt=1, nextDelayMs=500)
    C->>R: run(attemptFn, onAttempt)
    R->>R: wait(500ms)
    R->>D: attach(containerId)
    D-->>R: throws (daemon not ready)
    R->>R: wait(1000ms)
    R->>D: attach(containerId)
    D-->>R: AttachSession (success)
    R-->>C: "success"
    C->>Store: state = connected
```

### Failure Flow — Chosen Instance Gone on Force Reconnect

```mermaid
sequenceDiagram
    actor User
    participant V as ChatView.svelte
    participant C as TomoConnection
    participant D as DockerClient

    Note over C: state=disconnected (after exhausted reconnect)
    User->>V: Click Force Reconnect
    V->>C: forceReconnect()
    C->>D: inspect(containerId)
    D-->>C: null (container gone)
    C->>C: state = disconnected{reason: chosen-instance-gone}
    Note right of C: Picker NOT opened; user must go to Settings → Connect
    C-->>V: state change → show error in banner
```

### Error Handling

| Error source | Detection | Surface | Recovery |
|---|---|---|---|
| Docker daemon not running | dockerode rejects with ECONNREFUSED / ENOENT on socket | Settings inline (if user-initiated) OR chat-view banner (if passive) OR Notice (if palette) | User starts Docker; clicks Retry/Reconnect |
| Docker socket permission denied | dockerode rejects with EACCES | Settings inline with Linux-specific help text mentioning `docker` group | User adjusts group membership and retries |
| No Tomo instances found | listTomoInstances returns [] | Picker modal shows empty state with plain-English message | User starts a Tomo container and retries |
| Chosen instance gone (on reconnect) | inspect returns null | Chat view banner + status bar icon reflects disconnected; error code distinct | User opens Settings → Connect to pick another |
| Attach stream error mid-session | Node stream 'error' event or 'close' with non-clean reason | Auto-reconnect triggers; if exhausted → Disconnected with `reconnect-exhausted` | User clicks Force Reconnect, or Settings → Connect |
| Picker cancelled by user | User closes modal without selecting | Silent — stays Disconnected | None; next Connect restarts the flow |

### Complex Logic — Discovery result mapping

```
ALGORITHM: listTomoInstances
INPUT: Docker list response (containers with label miyo.component=tomo)
OUTPUT: TomoInstance[]

1. For each container in response:
   a. Extract container.Id (full ID) → containerId
   b. Slice containerId[0..12] → shortId
   c. Look up container.Labels["miyo.tomo.instance-name"]:
      - present and non-empty → name
      - absent or empty → null (picker and command label will fall back to shortId / static "Tomo")
   d. Parse container.State.StartedAt (ISO 8601) → Date startedAt
   e. Use container.Image (string, may be digest or tag) → image
2. Return sorted by startedAt DESC (newest first) so the most recently started instance is first in the picker
```

## Deployment View

### Single Application Deployment

- **Environment**: Obsidian Desktop plugin, loaded from the vault's `.obsidian/plugins/miyo-tomo-hashi/` directory.
- **Configuration**: No environment variables. Plugin data stored via `saveData()` (JSON blob in the vault-local plugin data file).
- **Dependencies**: Local Docker daemon reachable via socket. No network dependencies. No outbound HTTP other than Docker socket.
- **Performance**: Idle CPU near-zero (one attached TCP-over-socket stream, Node event loop). Memory proportional to xterm scrollback buffer (default ~1000 lines; ~100 KB for typical sessions). Plugin bundle ≤ 500 KB minified.
- **Distribution**: Community plugin listing (post-v0.1 release) + manual + BRAT (beta), per `README.md`.

### Rollback Strategy
Plugin disable via Obsidian Settings → Community Plugins is sufficient. No migrations, no external state to unwind.

## Cross-Cutting Concepts

### Pattern Documentation

```yaml
- pattern: "Ports & Adapters (Hexagonal)"
  relevance: HIGH
  why: "DockerClient port + DockerodeAdapter adapter; keeps the state machine testable without Docker"

- pattern: "Single source of truth with subscribe/teardown"
  relevance: HIGH
  why: "TomoConnection owns state; connectionStore (typed Store<T> helper) mirrors it; all UI subscribes and teardown is the returned unsubscribe. Prevents divergent views across Settings/status bar/chat without a framework runtime."

- pattern: "Obsidian singleton view via getLeavesOfType + setViewState"
  relevance: HIGH
  why: "Ensures the chat view is a singleton across sidebar/main-pane placements (PRD F4)"
```

### User Interface & UX

**Information architecture:**
- Settings: Connect/Disconnect + status. Entry point for picker.
- Status bar: icon-only, hover → tooltip, click → Menu popover.
- Chat view: pane-placeable; status indicator + Force Reconnect + terminal area + chat input.
- File explorer: right-click any file → `@file` action.

**Design system**: Obsidian's own CSS variables (`--background-primary`, `--text-normal`, `--interactive-accent`) for theming consistency. Status bar icon, chat-view indicator, and banner use Obsidian primitives (`setIcon`, CSS classes) — no custom component library. xterm.js uses its own theme object; populate it from Obsidian's CSS custom properties read via `getComputedStyle` on the view root at view-mount time.

**Accessibility:**
- Status bar icon, chat view status indicator, and in-view banner all convey state via shape + text (never color alone).
- Force Reconnect, Connect, Disconnect all keyboard-reachable (Tab order).
- Reduced motion: `@media (prefers-reduced-motion: reduce)` disables transitional animations in status bar icon and chat view indicator.
- ARIA live regions: `role="status"` with `aria-live="polite"` for transitional states (Reconnecting); `aria-live="assertive"` for Disconnected with an error.
- xterm.js ships with ARIA support for the terminal buffer; we keep its default a11y rendering on.

#### UI Visualization

**Status bar icon (entry point):**
```
╭─ Obsidian footer ────────────────────────────────────────╮
│  … other plugins …        友       Word count: 1243      │
╰──────────────────────────────────▲───────────────────────╯
                                  icon: green = connected
                                        amber = reconnecting
                                        grey  = disconnected
```

**Click popover (Obsidian Menu):**
```
      ╭─────────────────────────╮
      │ ↻ Force Reconnect        │
      │ 💬 Open Chat Window      │
      │ ⚙  Go to Settings        │
      ╰─────────────────────────╯
```

**Chat view (pane):**
```
┌─ Tomo Chat ──────────────────────────────── [force reconnect] ┐
│ ● Connected — my-tomo-dev                                      │
│ ──────────────────────────────────────────────────────────────│
│  [xterm.js terminal area — Claude Code TUI renders here]      │
│                                                                │
│ ──────────────────────────────────────────────────────────────│
│ > user input line                                              │
└────────────────────────────────────────────────────────────────┘
```

**State transitions (chat view):**
```mermaid
stateDiagram-v2
    [*] --> NotConnected
    NotConnected --> Attaching: user clicks Connect (Settings)
    Attaching --> Connected: attach succeeds
    Attaching --> Disconnected: attach fails
    Connected --> Reconnecting: stream error
    Reconnecting --> Connected: attempt succeeds
    Reconnecting --> Disconnected: bound exhausted
    Connected --> Disconnected: user clicks Disconnect
    Disconnected --> Attaching: Force Reconnect (chosen instance exists)
    Disconnected --> Disconnected: Force Reconnect (chosen instance gone)
```

### System-Wide Patterns

- **Security**: Docker socket access relies on OS-level file permissions. No credentials stored. Container output rendered as terminal text — no HTML, no URI activation. Chat input is opaque bytes from the user — sent to stdin as-is (claude interprets it).
- **Error Handling**: One `ConnectionError` discriminated union normalizes all error sources. Surface selection (banner vs Notice vs Settings inline) is the UI layer's job; `TomoConnection` just publishes state.
- **Performance**: Discovery is on-demand only. No polling. Stream reads flow through xterm.js directly — no per-byte allocation in our code. Reconnect backoff bounded at ~15.5 s; cancellable.
- **Logging**: `logger.ts` wraps `console.debug` tagged `[miyo-tomo-hashi]`. Logs state transitions and connection-error categories. No chat content is logged. Log level is compile-time fixed to `debug` in v0.1 (no setting).

### Multi-Component Patterns
Not applicable — single-component plugin. No RPC, no message queues, no inter-process coordination.

## Architecture Decisions

- [x] **ADR-1 Docker client library — dockerode**
  - Choice: Use [`dockerode`](https://github.com/apocas/dockerode) as the Docker client.
  - Rationale: Battle-tested, MIT, handles Unix socket on macOS/Linux and named pipe on Windows, correct attach stream hijack + demuxing.
  - Trade-offs: +~80 KB bundled; one runtime dep; tightly bound to its API shape (wrapped behind the `DockerClient` port to keep the rest of the code substitutable).
  - User confirmed: **YES** (brainstorm 2026-04-24).

- [x] **ADR-2 Attach mechanism — `docker attach` to PID 1 with xterm.js**
  - Choice: Attach to container PID 1 (claude TUI) via `docker attach`. Render bidirectional stdio in an embedded xterm.js terminal.
  - Rationale: Full-fidelity rendering of Claude Code's TUI (colors, cursor control, line editing). Preserves session (same process). No Tomo-side changes required.
  - Trade-offs: +~150 KB (xterm.js + xterm-addon-fit). Tomo container must run `claude` as PID 1 in TTY mode. Scrollback bounded by xterm's default (1000 lines).
  - User confirmed: **YES** (brainstorm 2026-04-24).

- [x] **ADR-3 UI approach — Plain TypeScript + DOM via Obsidian primitives** (revised 2026-04-24)
  - Choice: No UI framework. Obsidian base classes (`ItemView`, `PluginSettingTab`, `Modal`) are subclassed and build their DOM directly in their lifecycle methods. Obsidian primitives (`setIcon`, `Setting`, `Menu`, `Notice`) handle common UI needs. Subscribes to the state store for reactive updates; rebuilds affected DOM regions on state change.
  - Rationale: Minimal dep footprint (zero UI runtime). Transparent debugging — no compiled templates to read through. TDD-friendly with existing vitest + jsdom + obsidian mock setup (no `@testing-library/svelte` to integrate). For 4 reactive surfaces (Settings, status bar, chat view, palette command label) + xterm.js dominating the chat view's content area, the overhead of a framework runtime is not justified.
  - Trade-offs: More verbose at each UI surface (~10 extra lines for subscribe + manual re-render). No scoped CSS — classes must be prefixed (`hashi-`) to avoid leakage. CSS isolation is the only meaningful thing lost versus a framework.
  - Supersedes: ADR-3 prior revision (Svelte), recorded in brainstorm round 2026-04-24; revised same day after pros/cons review.
  - User confirmed: **YES** (2026-04-24, ADR batch round).

- [x] **ADR-4 State store — Custom typed `Store<T>` helper** (revised 2026-04-24)
  - Choice: A ~30-LOC `Store<T>` helper in `src/util/store.ts`, with `get()`, `set()`, `subscribe()` returning unsubscribe, plus a `derived<T,U>` function for computed slices. `connectionStore` exported as `Readable<ConnectionState>` (no `set`); a separate `connectionStoreWrite` handle is imported only by `TomoConnection`.
  - Rationale: Identical consumption ergonomics as Svelte stores (`subscribe` returns unsubscribe; fires immediately). Zero deps. Consistent with ADR-3's no-framework stance. Typed, testable in isolation, inspectable in the debugger.
  - Trade-offs: Write-discipline enforced by naming (`connectionStoreWrite`), not type-system. Alternative of a closure-sealed writer adds ceremony. RxJS would be more expressive for time-based pipelines but we don't need them.
  - Supersedes: ADR-4 prior revision (Svelte writable store), recorded in brainstorm round 2026-04-24; revised same day.
  - User confirmed: **YES** (2026-04-24, ADR batch round).

- [x] **ADR-5 Layer boundary — Ports & adapters at the Docker edge**
  - Choice: Define `DockerClient` as a TypeScript interface (port). `DockerodeAdapter` implements it. Unit tests inject a fake; live tests use the real adapter.
  - Rationale: Keeps `TomoConnection` state machine testable without spinning up containers. Honors the "no mocks for the Docker boundary in integration tests" feedback memory by ensuring the *port* never leaks to integration tests — live tests use the adapter directly.
  - Trade-offs: Extra file (interface + adapter). Slight boilerplate around each Docker call. Saves significant test-runtime when exercising state transitions.
  - User confirmed: **YES** (2026-04-24, ADR batch round).

- [x] **ADR-6 Singleton view management — `getLeavesOfType` + `setViewState`**
  - Choice: The chat view registers a view type (`VIEW_TYPE_TOMO_CHAT`). When invoking "Show chat window", first check `app.workspace.getLeavesOfType(VIEW_TYPE)`; if present, `app.workspace.setActiveLeaf(existing)`; if absent, `app.workspace.getRightLeaf(false).setViewState({ type: VIEW_TYPE, active: true })`. On plugin unload, detach leaves of this type.
  - Rationale: Obsidian-idiomatic. Enforces the PRD singleton rule (F4 AC2) without extra state tracking in the plugin.
  - Trade-offs: If the user has manually split the view into two panes, this returns the first one — acceptable per PRD (singleton means one view instance, not one visual location).
  - User confirmed: **YES** (2026-04-24, ADR batch round).

- [x] **ADR-7 Reconnect backoff — cancellable promise chain with explicit delays**
  - Choice: `ReconnectLoop` class holds a `cancelled` flag + a live timer handle. `run()` iterates a hard-coded `[500, 1000, 2000, 4000, 8000]` delay array, checking cancellation at each loop head and resolving the pending wait immediately on cancel. One `ReconnectLoop` instance per reconnect attempt sequence; `TomoConnection` disposes it when transitioning out of Reconnecting.
  - Rationale: Simpler than an RxJS observable pipeline; testable; exact schedule matches PRD F8 AC.
  - Trade-offs: Hand-rolled cancellation must be unit-tested explicitly (bug opportunity in the cancel-during-wait case — traced above in Implementation Examples).
  - User confirmed: **YES** (2026-04-24, ADR batch round).

- [x] **ADR-8 Dynamic command label — `removeCommand` + `addCommand` on state change**
  - Choice: `registerReconnectCommand` installs the command once, then re-installs it via `removeCommand(id) + addCommand({id, name: newLabel})` whenever `displayInstanceName` changes. Subscription is held by `plugin.register(unsubscribe)` for automatic teardown.
  - Rationale: Obsidian has no native "rename command" API. Re-registering is documented-idiomatic. Our implementation de-duplicates on identical labels to avoid churn.
  - Trade-offs: Command palette indices rebuild on each re-register (cheap — Obsidian handles this). Alternative of a static "Tomo Hashi: Reconnect" label loses the instance-name-in-label affordance the PRD specifies.
  - User confirmed: **YES** (2026-04-24, ADR batch round).

- [x] **ADR-9 Status bar popover — Obsidian `Menu` API**
  - Choice: Use Obsidian's built-in `Menu` class to render the status bar popover (three actions: Force Reconnect, Open Chat Window, Go to Settings). On click of the status bar icon, build a `new Menu()`, add three items, and call `menu.showAtMouseEvent(evt)`.
  - Rationale: Native, themed, accessible by default, zero custom DOM. Matches Obsidian UX conventions exactly.
  - Trade-offs: `Menu` doesn't support custom item disabled-state tooltips natively; the "Force Reconnect disabled with tooltip when no instance chosen" AC is handled by greying out the item and showing a tooltip via `titleEl` — an acceptable approximation.
  - User confirmed: **YES** (2026-04-24, ADR batch round).

- [x] **ADR-10 Test split — vitest unit + vitest live**
  - Choice: Unit tests (`test/unit/**/*.test.ts`) use the default `vitest.config.ts` (jsdom, obsidian mock, `FakeDockerClient`). Live tests (`test/live/**/*.live.test.ts`) use `vitest.live.config.ts` (node env, real Docker, 90 s timeouts). `npm test` runs unit only; `npm run test:live` runs live. CI runs both on PR.
  - Rationale: Fast feedback loop for logic; real-integration signal where it matters (Docker). Honors team feedback memory on real-Docker integration testing.
  - Trade-offs: Live tests require Docker on the CI runner. Developers without Docker run `npm test` only and rely on CI for live coverage. Live tests may flake if a container takes >90 s to start — we use `alpine:latest cat` as a lightweight stand-in that starts instantly.
  - User confirmed: **YES** (2026-04-24, ADR batch round).

## Quality Requirements

- **Performance**:
  - Plugin load → chat view ready to receive input: ≤ 500 ms p95 on a warm Obsidian start (measured from `onload` return to first xterm frame).
  - Discovery `listTomoInstances` p95: ≤ 300 ms against a local daemon with ≤ 20 containers total.
  - Attach to first byte from container: ≤ 500 ms p95.
  - Reconnect after transient disconnect: ≤ 15.5 s total before giving up (matches F8 AC).
  - Plugin bundle `main.js`: ≤ 500 KB minified.
- **Usability**:
  - All interactive controls reachable via Tab/Shift+Tab.
  - All state transitions announced to screen readers via ARIA live regions.
  - No motion for `prefers-reduced-motion: reduce`.
  - Color-independent state indication (icon shape + text label).
- **Security**:
  - No chat content logged.
  - No URI activation from container output.
  - Container output rendered through xterm.js only (terminal-safe).
  - No network access beyond Docker socket.
- **Reliability**:
  - Stream-error recovery bounded: auto-reconnect exhausts in ~15 s; no infinite retries.
  - Unsubscribe hygiene: every `subscribe()` call registered via `plugin.register()` so teardown is automatic on unload.
  - Idempotent lifecycle: calling `connect()` while already connected is a no-op; calling `disconnect()` while disconnected is a no-op.

## Acceptance Criteria

Traces each PRD acceptance criterion to an EARS-format system-level requirement. IDs prefix with spec ID for traceability.

**F1 Settings Connect (PRD/F1):**
- [ ] WHEN the user clicks Connect in Settings AND one or more containers match label `miyo.component=tomo`, THE SYSTEM SHALL open a picker populated with `TomoInstance[]` sorted by `startedAt` descending.
- [ ] WHEN the user clicks Connect AND no containers match, THE SYSTEM SHALL show an empty-state picker message "No Tomo instance seems to be running — start one and try again".
- [ ] WHEN the user clicks Connect AND the Docker daemon is unreachable, THE SYSTEM SHALL display error code `daemon-unreachable` with message "Docker daemon not reachable" inline in Settings.
- [ ] WHEN the user clicks Connect AND the Docker socket returns EACCES, THE SYSTEM SHALL display error code `socket-permission-denied` with a Linux-aware remediation message.
- [ ] WHILE Settings is the trigger surface, THE SYSTEM SHALL be the only surface that opens the picker.

**F2 Settings Disconnect (PRD/F2):**
- [ ] WHEN the user clicks Disconnect AND the state is `connected` or `reconnecting`, THE SYSTEM SHALL close the Docker attach stream and transition to `disconnected`.
- [ ] WHILE the state is `disconnected`, THE SYSTEM SHALL NOT display the Disconnect control.

**F3 Status bar icon (PRD/F3):**
- [ ] THE SYSTEM SHALL render exactly one status bar icon (Tomo kanji 友 preferred; fallback to a generic glyph).
- [ ] THE SYSTEM SHALL distinguish Connected / Reconnecting / Disconnected via icon shape or indicator element, never color alone.
- [ ] WHEN the user hovers the icon, THE SYSTEM SHALL display instance name (Connected), "Reconnecting…" (Reconnecting), or "Tomo: disconnected" (Disconnected).
- [ ] WHEN the user clicks the icon, THE SYSTEM SHALL open a Menu popover with three actions: Force Reconnect, Open Chat Window, Go to Settings.
- [ ] IF `chosenInstanceId` is null, THEN THE SYSTEM SHALL disable the Force Reconnect action in the popover with an explanatory tooltip.

**F4 Chat view (PRD/F4):**
- [ ] THE SYSTEM SHALL register exactly one view type (`VIEW_TYPE_TOMO_CHAT`).
- [ ] WHEN "Show chat window" is invoked AND a view of that type exists, THE SYSTEM SHALL focus the existing leaf.
- [ ] WHEN the chat view opens AND state is `connected`, THE SYSTEM SHALL enable and focus the chat input.
- [ ] WHILE state is not `connected`, THE SYSTEM SHALL disable the chat input.
- [ ] WHEN the user submits a message AND state is `connected`, THE SYSTEM SHALL write the message to the container's stdin.
- [ ] THE SYSTEM SHALL render container stdout/stderr through xterm.js only — no HTML rendering, no URI activation.

**F5 Chat view status + Force Reconnect (PRD/F5):**
- [ ] WHEN the connection state changes, THE SYSTEM SHALL update the in-view status indicator within one frame of the store update.
- [ ] WHEN the user clicks Force Reconnect AND the chosen instance exists, THE SYSTEM SHALL close any existing stream and re-attach.
- [ ] IF the chosen instance does not exist at Force Reconnect time, THEN THE SYSTEM SHALL stay in `disconnected` with error code `chosen-instance-gone` and SHALL NOT open the picker.

**F6 Reconnect command (PRD/F6):**
- [ ] WHEN an instance name is known, THE SYSTEM SHALL list the command as "Tomo Hashi: Reconnect to `<instance-name>`".
- [ ] WHEN no instance name is known, THE SYSTEM SHALL list the command as "Tomo Hashi: Reconnect to Tomo".
- [ ] WHEN the command is invoked AND state is `connected` or `reconnecting`, THE SYSTEM SHALL perform a Force Reconnect (identical semantics to F5).
- [ ] WHEN invoked AND state is `disconnected` AND `chosenInstanceId` is non-null, THE SYSTEM SHALL attempt reconnection to that instance.
- [ ] WHEN invoked AND `chosenInstanceId` is null, THE SYSTEM SHALL surface a Notice "No Tomo instance chosen — open Settings → Connect." and SHALL NOT open the picker.

**F7 Show chat window command (PRD/F7):**
- [ ] THE SYSTEM SHALL list "Tomo Hashi: Show chat window" at all times.
- [ ] WHEN invoked AND no leaf of type `VIEW_TYPE_TOMO_CHAT` exists, THE SYSTEM SHALL create one in the right sidebar.
- [ ] WHEN invoked AND a leaf exists, THE SYSTEM SHALL focus that leaf.

**F8 Automatic reconnect (PRD/F8):**
- [ ] WHEN the stream emits an error or closes unexpectedly WHILE state is `connected`, THE SYSTEM SHALL transition to `reconnecting(attempt=1)` and begin the backoff schedule `[500, 1000, 2000, 4000, 8000]` ms.
- [ ] WHEN a reconnect attempt succeeds, THE SYSTEM SHALL transition back to `connected` and clear any banner.
- [ ] WHEN all 5 attempts fail, THE SYSTEM SHALL transition to `disconnected` with error code `reconnect-exhausted` and SHALL NOT retry automatically.

**F9 Error surfacing (PRD/F9):**
- [ ] WHEN an error fires AND the chat view is open, THE SYSTEM SHALL surface it in the in-view banner.
- [ ] WHEN an error fires AND the invocation came from Settings, THE SYSTEM SHALL surface it inline in Settings AND update the status bar icon.
- [ ] WHEN an error fires AND the chat view is closed AND the source is palette, THE SYSTEM SHALL surface it via `Notice`.
- [ ] THE SYSTEM SHALL distinguish error codes: `daemon-unreachable`, `socket-permission-denied`, `no-instances`, `chosen-instance-gone`, `stream-error`, `reconnect-exhausted`.

**FS1 File right-click (PRD/FS1):**
- [ ] WHEN the user right-clicks any file in the file explorer, THE SYSTEM SHALL add a "Open Tomo chat with @file reference" menu item.
- [ ] WHEN the user invokes the item AND the chat view is open, THE SYSTEM SHALL insert `@<vault-relative-path> ` at the current chat input caret position and focus the input.
- [ ] WHEN the user invokes the item AND the chat view is closed, THE SYSTEM SHALL open the chat view and set the chat input value to `@<vault-relative-path> ` before focusing it.

**FS2 Remember last instance (PRD/FS2):**
- [ ] WHEN a connect succeeds, THE SYSTEM SHALL persist the container ID to `PluginSettings.chosenInstanceId` via `saveData`.
- [ ] WHEN the plugin loads AND `chosenInstanceId` is non-null, THE SYSTEM SHALL attempt to `inspect` that container; if present, auto-reconnect via the normal backoff; if absent, stay `disconnected` with error code `chosen-instance-gone` and SHALL NOT open the picker.

## Risks and Technical Debt

### Known Technical Issues
- Current `manifest.json` has `isDesktopOnly: false` — PRD-level drift; must be fixed in the first implementation phase.
- No Docker client dep is pulled in yet — must add `dockerode`, `@types/dockerode` before any connection work.
- xterm.js deps + CSS loader addition to `esbuild.config.mjs` need validation — first phase of the plan should validate the build with a tiny xterm-hosting DOM element before building the full chat view. (No framework preprocessor to integrate — the plain-TS approach keeps this cheap.)

### Technical Debt
- `Store<T>` write-discipline is enforced by naming (`connectionStoreWrite` separate export), not by the type system. If the plugin grows, consider a fully-sealed store where the writer lives inside a closure and only the `TomoConnection` constructor receives it. Tolerable at current size.
- CSS class names use a `hashi-` prefix convention to prevent leakage (no scoped CSS in plain-TS approach). This is a code review discipline; a regression would only show up as visual theming issues, not functional failures.
- xterm.js theme is populated once from Obsidian CSS variables at view creation; if the user switches Obsidian theme while the chat is open, colors will be stale until the view is reopened. Noted; fix is post-v0.1.

### Implementation Gotchas
- **Attach stream demuxing**: when the container runs without TTY (`tty=false`), Docker interleaves stdout and stderr as frames with a 8-byte header. dockerode exposes `modem.demuxStream(stream, stdout, stderr)`. The adapter must detect TTY mode from `inspect` output and demux accordingly. Writing a unified handler for both modes saves pain later.
- **`addCommand` duplicate registration**: Obsidian silently replaces an existing command on duplicate ID, but editing command names via re-register requires explicit `removeCommand` first. Missing the remove leads to two commands with the same ID — one visible, one orphaned in the internal map.
- **`registerEvent(app.workspace.on('file-menu', ...))` callback signature**: has three arguments `(menu, file, source)`. Return value is ignored. Menu item must be added synchronously; async work deferred until click callback.
- **xterm.js resize**: the chat view changes size as the user resizes the pane. Must use `@xterm/addon-fit` and call `fit()` on the view's resize event; otherwise the terminal's column count drifts.
- **xterm.js CSS bundling**: `@xterm/xterm/css/xterm.css` must be loaded. Options: (a) import it from TS and configure an esbuild CSS loader that injects it into `styles.css`; (b) inline it as a string and append to `<head>` at view creation. Option (a) is cleaner; option (b) avoids esbuild config changes if the CSS loader proves problematic.
- **Plugin unload timing**: `onunload` is synchronous. Async cleanup (closing Docker stream) must be initiated but cannot be awaited. Ensure no open file descriptors remain after a best-effort close; accept that Obsidian's process management handles the stragglers.
- **Windows Docker support**: dockerode defaults to Unix socket on non-Windows; on Windows it uses `\\.\pipe\docker_engine`. We rely on dockerode's autoDetect. Windows is user-contribution tier per architecture-06 — we don't gate the SDD on it, but the adapter's socket detection must not assume POSIX.

## Glossary

### Domain Terms

| Term | Definition | Context |
|------|------------|---------|
| Tomo | The Claude Code CLI running in a Docker container. The "live AI" endpoint Hashi talks to. | Spec 001 connects to a Tomo container; spec 002 consumes its file output offline. |
| Tomo instance | A single running Docker container labeled `miyo.component=tomo`. | Discovery returns a list of these; the user picks one. |
| Hashi | miyo-tomo-hashi, the Obsidian plugin. | This repo. |
| Chosen instance | The Tomo instance the user most recently connected to (persisted as `chosenInstanceId`). | Used by Force Reconnect and auto-reconnect on launch. |
| Instance name | Human-readable name exposed as label `miyo.tomo.instance-name`. | Shown in picker rows, status bar tooltip, command palette label. |
| Session | In Tomo, the Claude Code process state inside one container. Hashi does not create, identify, or persist session IDs — it attaches to whatever stdio the container exposes. | v0.1: one session per container, container-life-bound. |

### Technical Terms

| Term | Definition | Context |
|------|------------|---------|
| Attach stream hijack | Docker's attach endpoint upgrades the HTTP connection to a raw bidirectional byte stream. | dockerode handles this transparently. |
| TTY demuxing | When a container was not started with `-t`, Docker interleaves stdout and stderr as framed packets with an 8-byte header. | Our adapter detects TTY mode via `inspect` and uses `modem.demuxStream()` when needed. |
| Port & adapter | Architectural pattern where the core (`TomoConnection`) depends on an interface (`DockerClient`) rather than a concrete implementation. | Enables testing without Docker. |
| Writable store | Svelte primitive that holds a value and notifies subscribers on change. | `connectionStore` is the one such store in 001. |
| Singleton view | An Obsidian view for which at most one leaf exists at any time. | `VIEW_TYPE_TOMO_CHAT` is enforced singleton via `getLeavesOfType`. |

### API/Interface Terms

| Term | Definition | Context |
|------|------------|---------|
| `VIEW_TYPE_TOMO_CHAT` | String constant identifying the chat view. | Used in `registerView()`, `getLeavesOfType()`, `setViewState()`. |
| `EACCES` | POSIX error: permission denied when opening a file or socket. | Mapped to error code `socket-permission-denied`. |
| `ECONNREFUSED` / `ENOENT` | POSIX errors when no process is listening on the socket path. | Both mapped to error code `daemon-unreachable`. |
| `ItemView` | Obsidian base class for pane-placeable custom views. | `TomoChatView extends ItemView`. |
| `Menu` | Obsidian utility class for context/popover menus. | Used for the status bar popover. |
