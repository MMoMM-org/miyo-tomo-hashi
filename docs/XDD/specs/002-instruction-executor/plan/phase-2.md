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
- ADR-1: validator is generated; this phase wraps it with diagnostics
- ADR-2: schema is vendored — validator wrapper imports the generated `validator.gen.js`
- ADR-7: every JSON edit goes through `vault.process` with `JSON.stringify(v, null, 2) + "\n"` formatting
- ADR-9: tests use `FakeVaultFS` (unit) + `FsPromisesVaultFS` (live)

**Dependencies**: Phase 1 (vendored schema, types, path-safety utility, mock).

---

## Tasks

This phase implements the vault edge — the `VaultFS` port + the three adapters (Obsidian, in-memory fake, fs/promises live) — plus the schema validator wrapper that converts ajv diagnostics into our typed failure shape.

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

- [ ] **T2.3 FakeVaultFS + FsPromisesVaultFS** `[activity: testing]`

  1. Prime: Read SDD test split `[ref: SDD/ADR-9]` and the `test/fixtures/instructions/` layout in SDD Directory Map `[ref: SDD/Directory Map]`.
  2. Test: For each adapter, run the T2.1 contract test:
     - `test/unit/vault/FakeVaultFS.test.ts` — FakeVaultFS contract pass
     - `test/live/vault/FsPromisesVaultFS.live.test.ts` — FsPromisesVaultFS contract pass against a fresh `os.tmpdir()` directory; cleans up after each test
  3. Implement:
     - Create `src/vault/FakeVaultFS.ts` — in-memory `Map<path, string>` impl. `process` uses a per-path Promise queue for atomicity simulation. `metadata` returns a constructor-injected fake `FileMetadata` per path or `null`.
     - Create `test/live/helpers/FsPromisesVaultFS.ts` (live-only) — `fs/promises` impl against a tmpdir. `metadata` returns `null` (live tests don't exercise metadata-dependent handlers; those go through Fake).
     - Live test config: `vitest.live.config.ts` already exists; ensure it includes `test/live/**`.
  4. Validate: Both adapters pass the contract test. `npm test` (unit) green; `npm run test:live` green.
  5. Success:
     - [ ] Both adapters pass the same contract `[ref: SDD/ADR-9]`
     - [ ] Live tests run against real `fs/promises` semantics `[ref: SDD/ADR-9]`

- [ ] **T2.4 SchemaValidator wrapper** `[activity: domain-modeling]`

  1. Prime: Read PRD F2 (full AC list) `[ref: PRD/F2]`; read SDD "Schema Validator" — the wrapper around `validator.gen.js` that converts ajv errors into typed diagnostics `[ref: SDD/Architecture Decisions; ADR-1]`.
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
       | { ok: false; failure: ValidationFailure };
     export type ValidationFailure =
       | { kind: "parse-error"; detail: string }
       | { kind: "version-mismatch"; got: unknown }
       | { kind: "schema-diagnostics"; diagnostics: Diagnostic[] };
     export function validate(raw: unknown): ValidationOutcome;
     ```
     The wrapper imports `validator.gen.js`, runs it, and translates `ajv`'s error array into our `Diagnostic[]` shape (each with path, message, params).
  4. Validate: All validator tests pass; benchmark with 100-action fixture confirms < 200 ms; lint clean.
  5. Success:
     - [ ] All PRD F2 ACs satisfied `[ref: PRD/F2]`
     - [ ] Validation budget met `[ref: PRD/F2; SDD/Quality Requirements]`
     - [ ] Validator output is typed (`InstructionSet` on success) `[ref: SDD/Application Data Models]`

- [ ] **T2.5 Phase 2 Validation** `[activity: validate]`

  - Run `npm run schema:build && npm run build && npm test && npm run test:live && npm run lint`. All green.
  - Confirm:
    - All three VaultFS adapters pass the same contract test
    - Schema validator handles all six failure varieties (parse, version mismatch, structure diagnostics, unknown kind, duplicate I##, missing required)
    - The applied-field round-trip works (validator accepts `applied: true` from a previously-run JSON)
    - Live tests pass against real fs/promises
