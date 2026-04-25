---
title: "Phase 1: Foundation"
status: pending
version: "1.0"
phase: 1
---

# Phase 1: Foundation

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- PRD: `docs/XDD/specs/001-session-view/requirements.md` — "Constraints and Assumptions", "Feature Requirements" (for type shapes)
- SDD: `docs/XDD/specs/001-session-view/solution.md` — "Constraints" (CON-1..CON-9), "Application Data Models", "State Store (typed Store<T> helper)", "Directory Map"
- Project: `CLAUDE.md`, `src/CLAUDE.md` (TDD gate), `test/CLAUDE.md`, `esbuild.config.mjs`, `tsconfig.json`, `package.json`, `manifest.json`

**Key Decisions** (affecting this phase):
- ADR-3: plain TS (no framework)
- ADR-4: custom `Store<T>` (~30 LOC)
- Manifest drift: `isDesktopOnly: false → true` is a MUST-fix constraint

**Dependencies**: None. This is the foundation phase; Phases 2–5 depend on it.

---

## Tasks

This phase establishes build foundations, shared types, the state-store primitive, and an extended obsidian test mock — everything the rest of the plan consumes.

- [ ] **T1.1 Flip `manifest.json` to desktop-only + add runtime deps** `[activity: platform]`

  1. Prime: Read PRD Constraints `[ref: PRD/Constraints; platform line]` and SDD CON-1, CON-2 `[ref: SDD/Constraints; CON-1..CON-2]`.
  2. Test: No unit test needed for static config. Create a tiny assertion test `test/unit/manifest.test.ts` that reads `manifest.json` and asserts `isDesktopOnly === true` (protects against regression).
  3. Implement:
     - Edit `manifest.json`: set `"isDesktopOnly": true`.
     - Edit `package.json` dependencies: add `"dockerode": "^4.0.2"`, `"@xterm/xterm": "^5.5.0"`, `"@xterm/addon-fit": "^0.10.0"`. DevDependencies: add `"@types/dockerode": "^3.3.29"`.
     - `npm install`.
  4. Validate: `npm run build` passes; `npm test` passes (manifest assertion green); `npm run lint` clean.
  5. Success:
     - [ ] `manifest.json` has `isDesktopOnly: true` `[ref: PRD/Constraints; SDD/CON-1]`
     - [ ] Runtime deps installed and resolvable by TypeScript `[ref: SDD/CON-2]`
     - [ ] Manifest regression test added and passing `[ref: SDD/Acceptance Criteria; Quality]`

- [ ] **T1.2 Extend esbuild config for xterm CSS** `[activity: platform]`

  1. Prime: Read `esbuild.config.mjs` + SDD implementation gotcha on xterm CSS bundling `[ref: SDD/Implementation Gotchas]`.
  2. Test: Add a smoke check to `test/unit/build-output.test.ts` that reads the production `main.js` after build and asserts the file exists and is non-empty (no functional assertion yet; validates the pipeline).
  3. Implement:
     - In `esbuild.config.mjs`, add a loader entry mapping `.css` to `"css"`. Import `@xterm/xterm/css/xterm.css` from wherever xterm is first used (Phase 4); for Phase 1, just ensure the config handles `.css`.
     - Option: inline via `loader: { ".css": "text" }` and append to `<head>` at view mount time — see SDD gotcha for rationale if CSS loader has issues.
  4. Validate: `npm run build` produces `build/main.js`; build output is non-empty.
  5. Success:
     - [ ] Production build succeeds with new config `[ref: SDD/CON-2]`
     - [ ] Build output smoke test passes `[ref: SDD/Quality Requirements; bundle budget]`

- [ ] **T1.3 Introduce `Store<T>` helper and `derived`** `[activity: domain-modeling]`

  1. Prime: Read SDD "State Store (typed Store<T> helper)" section with full code sketch `[ref: SDD/Interface Specifications; State Store]`.
  2. Test: Write `test/unit/util/store.test.ts`:
     - `get()` returns initial value
     - `subscribe(fn)` fires immediately with current value
     - `subscribe(fn)` fires on every `set(next)` where `!Object.is(prev, next)`
     - `subscribe(fn)` does NOT fire when `Object.is(prev, next)` is true (identity-dedup)
     - `subscribe` return value unsubscribes; subsequent sets don't call the disposed listener
  3. Implement: Create `src/util/store.ts` with the `Store<T>` class only (no `derived<T,U>`, no separate `Readable<T>` interface — both dropped in 2026-04-25 simplification per ADR-4 v3). Subscribers compute derived values inline.
  4. Validate: All store.test.ts cases pass; types compile; no `any`.
  5. Success:
     - [ ] All store behaviors verified via unit tests `[ref: SDD/ADR-4]`
     - [ ] Derived stores update on source change `[ref: SDD/State Store]`

- [ ] **T1.4 Define connection domain types** `[activity: domain-modeling]`

  1. Prime: Read SDD "Application Data Models" — `ConnectionState`, `TomoInstance`, `ConnectionError`, extended `PluginSettings` `[ref: SDD/Application Data Models]`.
  2. Test: Write `test/unit/connection/state.test.ts`:
     - Exhaustive switch over `ConnectionState["kind"]` compiles (TypeScript exhaustiveness)
     - Narrowing: when `kind === "connected"`, `instance: TomoInstance` is non-null
     - `ConnectionError` discriminated union codes are all handleable in a switch
  3. Implement:
     - Create `src/connection/state.ts` with the `ConnectionState` discriminated union
     - Create `src/connection/types.ts` with `TomoInstance`, `ConnectionError`
     - Modify `src/types/index.ts` with `PluginSettings { chosenInstanceId: string | null }` and `DEFAULT_SETTINGS`
  4. Validate: Tests pass; `npm run build` typechecks cleanly; no `any`.
  5. Success:
     - [ ] Types usable in downstream phases `[ref: SDD/Application Data Models]`
     - [ ] Discriminated union enforces exhaustive handling `[ref: SDD/State]`

- [ ] **T1.5 Extend obsidian test mock** `[activity: testing]`

  1. Prime: Read `test/__mocks__/obsidian.ts` (current state), SDD "Directory Map" (what new Obsidian classes the plan uses) `[ref: SDD/Directory Map]`.
  2. Test: Write `test/unit/__mocks__/obsidian-shape.test.ts` that imports the mock and asserts the presence of: `ItemView`, `WorkspaceLeaf`, `Menu`, `Modal`, `EventRef`, `setIcon` (as a vi.fn), and confirms `Plugin.registerView` / `Plugin.registerEvent` / `Plugin.register` exist.
  3. Implement:
     - Add `ItemView` (extends `Component`; has `onOpen`, `onClose`, `leaf: WorkspaceLeaf`, `contentEl`)
     - Add `WorkspaceLeaf` (has `setViewState`, `view`, `detach`)
     - Add `Menu` (has `addItem(cb)` → item with `setTitle/setIcon/setDisabled/onClick`; `showAtMouseEvent`)
     - Add `Modal` (has `open`, `close`, `contentEl`, `onOpen`, `onClose`)
     - Add `setIcon` as a `vi.fn()`
     - Extend `Plugin` with `registerView`, `registerEvent`, `register`, `removeCommand`
     - Extend `App.workspace` with `getLeavesOfType`, `getRightLeaf`, `getLeaf`, `revealLeaf`, `setActiveLeaf`, `on`
  4. Validate: Mock-shape test passes; existing tests still pass.
  5. Success:
     - [ ] Mock covers every Obsidian API used by Phases 3–5 `[ref: SDD/Integration Points; Obsidian]`
     - [ ] Existing tests continue to pass `[ref: test/CLAUDE.md]`

- [ ] **T1.6 Phase 1 Validation** `[activity: validate]`

  - Run `npm run build && npm test`. Verify: manifest desktop-only, all unit tests pass (Store<T>, state types, mock shape, manifest regression, build smoke). Lint clean. Tick all Phase 1 checkboxes in `plan/README.md` phases list.
  - Success: All Phase 1 tests pass; foundation deps and types available for Phase 2.
