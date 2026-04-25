---
title: "Phase 2: Vault Boundary & Schema"
status: pending
version: "1.0"
phase: 2
---

# Phase 2: Vault Boundary & Schema

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- PRD: F2 (Schema validation), F4 (action kinds — for VaultFS surface), F5 (atomic JSON write), F9 (path safety integration) — `[ref: PRD/F2, F4, F5, F9]`
- SDD: VaultFS Port; ObsidianVaultFS adapter; Schema Validator wrapper; ADR-1 (ajv standalone); ADR-7 (vault.process atomic write) — `[ref: SDD/Interface Specifications; VaultFS Port]` `[ref: SDD/Architecture Decisions; ADR-1, ADR-7]`

**Key Decisions** (affecting this phase):
- ADR-1 (revised 2026-04-25): ajv 8.x compiles at module load; this phase wraps it with a thin `validate()` returning `{ ok, data } | { ok, message }` (single human string — no `Diagnostic[]` array).
- ADR-2: schema is vendored — validator imports the schema JSON and compiles it via ajv at module load.
- ADR-7: every JSON edit goes through `vault.process` with `JSON.stringify(v, null, 2) + "\n"` formatting.
- ADR-9 (revised 2026-04-25): tests use `FakeVaultFS` (unit) only — manual QA in `../temp/Privat-Test` is the integration gate. `FsPromisesVaultFS` was dropped (cannot exercise Obsidian-specific semantics).

**Dependencies**: Phase 1 (vendored schema, types, path-safety utility, mock).

---

## Tasks

This phase implements the vault edge — the `VaultFS` port + two adapters (Obsidian for production, in-memory fake for unit tests) — plus the schema validator wrapper that compiles ajv against the bundled schema and flattens any error array to a human string.

- [ ] **T2.1 VaultFS port** `[activity: domain-modeling]`

  1. Prime: Read SDD "VaultFS Port" `[ref: SDD/Interface Specifications; VaultFS Port (port/adapter pattern)]`. Read SDD "Cross-Component Boundaries" for the test-substitution principle `[ref: SDD/Cross-Component Boundaries]`.
  2. Test: Write `test/unit/vault/VaultFS.contract.test.ts`. The contract test exports a function `runContractTests(makeVaultFS: () => VaultFS)` that any adapter implementation can pass. Asserted behaviors:
     - `read` and `exists` round-trip with `create`
     - `process(path, fn)` is atomic — concurrent processes serialize (asserted by interleaving two awaits)
     - `processJSON<T>(path, fn)` outputs `JSON.stringify(v, null, 2) + "\n"` exactly (formatting assertion)
     - `rename(from, to)` moves the file; `read(from)` then fails with not-found
     - `trash(path)` makes `exists(path)` return false
     - `createFolder(path)` is idempotent (no error on already-exists)
     - `list(folder)` returns non-recursive entries
     - `metadata(path)` returns `null` when no metadata is available, otherwise an object with `headings` + `sections`
  3. Implement: Create `src/vault/VaultFS.ts` with the port interface only (no adapter yet).
  4. Validate: Type-only file; no implementation. The contract test fixture compiles and is ready to be invoked by adapter tests in T2.2/T2.3.
  5. Success:
     - [ ] Port interface matches SDD `[ref: SDD/VaultFS Port]`
     - [ ] Contract test runner ready for use by all three adapters `[ref: SDD/ADR-9]`

- [ ] **T2.2 ObsidianVaultFS adapter** `[activity: integration]`

  1. Prime: Read Obsidian Plugin API docs sections cited in SDD `[ref: SDD/External APIs; Obsidian Plugin API]`. Read SDD "Implementation Gotchas" — note the `vault.process`, `fileManager.renameFile`, MetadataCache lag warnings `[ref: SDD/Implementation Gotchas]`.
  2. Test: Write `test/unit/vault/ObsidianVaultFS.test.ts` that:
     - Runs the contract test from T2.1 against `ObsidianVaultFS` constructed with the mocked Obsidian app
     - Verifies `rename` calls `app.fileManager.renameFile` (NOT `app.vault.rename`)
     - Verifies `trash` calls `app.vault.trash(file, true)` (system trash)
     - Verifies `process` and `processJSON` use `app.vault.process` (atomic primitive)
     - Verifies `createFolder` swallows the "Folder already exists" error
     - Verifies `metadata` reads from `app.metadataCache.getFileCache`
  3. Implement: Create `src/vault/ObsidianVaultFS.ts` per SDD. Implements every `VaultFS` method by delegating to the Obsidian app instance passed in the constructor.
  4. Validate: All ObsidianVaultFS tests pass; ESLint clean; types pass.
  5. Success:
     - [ ] Adapter passes the full contract test `[ref: SDD/VaultFS Port]`
     - [ ] `fileManager.renameFile` (not `vault.rename`) used for moves `[ref: PRD/F4; SDD/Implementation Gotchas]`
     - [ ] `vault.trash` with system flag used for delete `[ref: PRD/F4]`

- [ ] **T2.3 FakeVaultFS** `[activity: testing]` (FsPromisesVaultFS dropped 2026-04-25 per ADR-9 revision)

  1. Prime: Read SDD test split `[ref: SDD/ADR-9 (revised 2026-04-25)]` and the `test/fixtures/instructions/` layout in SDD Directory Map `[ref: SDD/Directory Map]`.
  2. Test:
     - `test/unit/vault/FakeVaultFS.test.ts` — FakeVaultFS contract pass
  3. Implement:
     - Create `src/vault/FakeVaultFS.ts` — in-memory `Map<path, string>` impl. `process` uses a per-path Promise queue for atomicity simulation. `metadata` returns a constructor-injected fake `FileMetadata` per path or `null`.
  4. Validate: FakeVaultFS passes the contract test. `npm test` (unit) green.
  5. Success:
     - [ ] FakeVaultFS passes the contract `[ref: SDD/ADR-9 (revised 2026-04-25)]`
     - [ ] Production confidence comes from manual QA in `../temp/Privat-Test` (Phase 6 T6.4), not from a node-fs adapter `[ref: SDD/ADR-9 (revised 2026-04-25)]`

- [ ] **T2.4 SchemaValidator wrapper** `[activity: domain-modeling]`

  1. Prime: Read PRD F2 (full AC list) `[ref: PRD/F2]`; read SDD "Schema Validator" — `src/schema/validator.ts` imports ajv 8.x and the schema JSON, compiles a validator at module load, flattens ajv's error array to a single human string at the boundary `[ref: SDD/Architecture Decisions; ADR-1 (revised 2026-04-25)]`.
  2. Test: Write `test/unit/schema/validator.test.ts`. Use fixture files from `test/fixtures/instructions/` (created in T2.3 fixture layout):
     - Valid v1 → `{ ok: true; data }`
     - `schema_version: 0` / `2` / missing → `{ ok: false; failure: { kind: "version-mismatch", got } }`
     - Malformed JSON (caller already parses, so this case is a JSON.parse error caught upstream — the validator runs only after parse succeeds; assert validator handles unexpected-shape input gracefully too)
     - Unknown action `kind` → `{ ok: false; failure: { kind: "schema-diagnostics"; diagnostics: [...] } }`
     - Duplicate `I##` → flagged by schema's `uniqueItems` constraint OR by the validator wrapper if not in the schema (assert one or the other)
     - Missing required field → schema diagnostic
     - Wrong type (e.g., `applied: "true"` string) → schema diagnostic
     - Action with `applied: true` → still validates (the field is optional + boolean)
     - Validation completes < 200ms for a 100-action fixture
  3. Implement: Create `src/schema/validator.ts`:
     ```ts
     export type ValidationOutcome =
       | { ok: true; data: InstructionSet }
       | { ok: false; message: string };
     export function validate(raw: unknown): ValidationOutcome;
     ```
     The module imports ajv + the schema JSON, compiles a validator at module load (~once), and flattens any ajv error array to a single human string at the boundary. No `Diagnostic[]`, no `ValidationFailure` discriminated union — both collapsed in the 2026-04-25 simplification.
  4. Validate: All validator tests pass; benchmark with 100-action fixture confirms < 200 ms; lint clean.
  5. Success:
     - [ ] All PRD F2 ACs satisfied `[ref: PRD/F2]`
     - [ ] Validation budget met `[ref: PRD/F2; SDD/Quality Requirements]`
     - [ ] Validator output is typed (`InstructionSet` on success) `[ref: SDD/Application Data Models]`

- [ ] **T2.5 Phase 2 Validation** `[activity: validate]`

  - Run `npm run build && npm test && npm run lint`. All green. (Per ADR-1 v2 / ADR-9 v2: no `schema:build` prebuild, no `test:live` for FsPromisesVaultFS — manual QA in `../temp/Privat-Test` is the Phase 6 integration gate.)
  - Confirm:
    - Both VaultFS adapters (ObsidianVaultFS, FakeVaultFS) pass the same contract test
    - Schema validator collapses all failure modes (parse, version mismatch, structure diagnostics, unknown kind, duplicate I##, missing required) to one human-readable string per file
    - The applied-field round-trip works (validator accepts `applied: true` from a previously-run JSON)
