# Troubleshooting Memory

<!-- 2026-06-23 -->
## Adding a new instruction action kind — `KIND_ORDER` is a silent-drop trap
**Symptom:** a newly-added action kind is registered (schema `$def` + `oneOf`, `ActionKind`
union, `HANDLERS`, handler file) and the full unit suite is green — but the action never
executes end-to-end.
**Cause:** `src/executor/planner.ts` has a `KIND_ORDER: readonly ActionKind[]` array, and
`computeRemaining` iterates **only** over `KIND_ORDER` (`for (const kind of KIND_ORDER)`). A kind
absent from that array is silently dropped from the execution list — no error, no warning. The
unit suite passes because handler/validator/registry tests exercise the kind in isolation; none
plans a fixture set end-to-end, so the gap is invisible. (`buildSummary`'s exhaustive switch IS
compiler-enforced, so it catches you — but `KIND_ORDER` is a plain array and is not.)
**How to apply:** when adding an action kind, the wiring checklist is **5** places, not 4 —
(1) schema `$def` + `oneOf` — the `$def` **must** include `"applied": {"$ref": "#/$defs/applied_field"}`
or `vendored-schema.test.ts` fails (it asserts every `oneOf` variant references it),
(2) `ActionKind`/`Action` types, (3) `HANDLERS` registry,
(4) `KIND_ORDER` (pick the canonical slot), (5) `buildSummary` case. Add a planner
`computeRemaining` test asserting the new kind appears in its canonical-order slot — that's the
only test that proves it's actually planned. Several `*.test.ts` files also hard-code the kind
**count** (types.test.ts `toHaveLength` + literal union, actions/index.test.ts key list) — bump
those too, AND the count is also restated in prose across docs (README twice, action-reference.md
intro, hooks.md's inline kind list, troubleshooting.md's "one of the N kinds") — grep for the old
count word after any kind change, it drifts independently of the enforced test sites. (Landed with
`insert_under_marker` PR #73; re-confirmed end-to-end adding `replace_section`, the 11th kind,
2026-06-25; `edit_note_text` landed as the 12th 2026-07-21; `remove_up_link` landed as the 13th
2026-07-23 — a field-preserving sibling to `edit_note_text` for multi-link `up::` lines that the
whole-line action couldn't safely edit; `resolve_dead_link` landed as the 14th 2026-07-25 (Tomo
commit 4251618) — alias-aware unlink/repoint superseding `edit_note_text` for dead-link fixes,
which silently no-oped on aliased links since it only matched the whole `[[…]]` text verbatim.
Also re-vendor the schema first (ADR-7 full re-vendor, `git show <tomo-branch>:tomo/schemas/
hashi-instructions.schema.json`) rather than hand-editing — confirm byte-parity + `$defs` count
before touching TS.)

## Run log written as bare placeholder (`totals: {}`, empty body)
**Symptom:** a run produces a run-log file whose frontmatter has `totals: {}` and no action table.
**Cause:** the run threw between `RunLogWriter.start()` (writes the placeholder) and
`finalize()` (overwrites with the real content). Earlier `InstructionExecutor.run()` called
`finalize()` as a bare `await`, so any uncaught throw in the action loop or the post-loop
`markActionsApplied` flush aborted the run and stranded the placeholder.
**Fix (#51 follow-up):** the loop+flush are wrapped; `finalize()` always runs (success and
abort), and on abort a `(run error) → run aborted: <reason>` row is written plus a
`[hashi] run aborted before finalize:` `console.error`. The aborting error still propagates
to the caller. A stranded `totals: {}` log no longer happens — an aborted run self-documents.
**Update (2026-06-09, #58 → 0.8.1):** the #51 try/catch was necessary but NOT sufficient. The
190-byte placeholder kept reappearing in vaults running frontmatter automators (see next entry):
the two-write lifecycle — `start()` `create`s a placeholder, `finalize()` overwrites it — let a
stale placeholder copy win a write race and clobber an already-finalized log back to `totals: {}`,
with **no Hashi throw**, so the try/catch never fired. Real case: a `confirm`-mode run logged
`run complete` (finalize ran, no `finalize failed`) yet the file was the 190-byte placeholder.
Fixed by making `RunLogWriter` **write-once**: `start()` only reserves the collision-free path
(writes nothing), `finalize()` creates the file exactly once via `vault.create()` (or, under
`only-after-failed` with 0 failures, nothing). An aborted run now leaves **no file at all** (not a
placeholder), and the single write halves the modify events the automators race against. See
`decisions.md` for the write-once guardrail.

## Privat-Test QA vault rewrites Hashi's output files (frontmatter automators)
**Symptom:** Hashi-written files (run logs, instruction `.json`) gain an `Updated:` frontmatter
field Hashi never emits; run logs occasionally clobbered back to the placeholder; MetaEdit throws
`Uncaught (in promise) TypeError: Cannot read properties of null (reading 'frontmatter')` in the
dev console during a run.
**Cause:** the `temp/Privat-Test` QA vault has frontmatter-automation plugins enabled — an Obsidian
Linter "update time on edit"-style rule (the `Updated:` stamp) and MetaEdit (`onFileModify`). They
react to every Hashi `vault.create`/`vault.process` and rewrite the file underneath Hashi. This is
a third-party / environment effect, **not** a Hashi bug — but it produced real symptoms (the
run-log clobber above), and the MetaEdit throw is triggered by Hashi's note modifies (MetaEdit
reads `metadataCache` before Obsidian refreshes it post-write → null frontmatter).
**How to apply:** when debugging odd file behavior in the QA vault, check which plugins touch
frontmatter on modify before assuming Hashi caused it — the `Updated:` field is the fingerprint
(it sits on every Hashi log, good or clobbered). Don't "fix" third-party throws in Hashi.

<!-- 2026-07-26 -->
## `FakeVaultFS.process`/`processJSON` doesn't throw "File not found" on a missing path
**Symptom:** a test asserting a vault-failure path rejects with `"File not found"` (mirroring
`FakeVaultFS.read`'s behavior) fails with `SyntaxError: Unexpected end of JSON input` instead.
**Cause:** `read()` throws on a missing path, but `process()`/`processJSON()` default to `""`
(`this.content.get(path) ?? ""`) rather than throwing — so a JSON-based writer's own
`JSON.parse("")` is what fails, not a vault-level "not found" error. This differs from the real
`ObsidianVaultFS`, whose `process()` calls `requireFile()` first and does throw "File not found".
**How to apply:** when writing a `processJSON`-based failure/denial test against `FakeVaultFS`
with an unseeded path, assert `.rejects.toThrow(SyntaxError)` (or the JSON parse message), not
`"File not found"`. (Found adding L1 failure-path coverage for `markActionFields`, spec 006 T1.2.)

## Dev console flooded by `[hashi:hooks]` lines during a run (#52)
**Cause:** `FsHookLoader.resolve()` ran per (phase × action) — a 126-action run did ~250
`readdirSync` calls, each `console.debug`-logging (and logging the ENOENT when the hooks
dir is absent). This buried real errors.
**Fix:** `HookRunner` caches resolution per run (primed once by `preApprove`, reset by
`beginRun()`), so each key resolves at most once per run instead of per action. The
`[hashi:hooks]` traces are **not deleted** — they are gated behind the `debugLogging`
setting: `FsHookLoader` takes an optional `debug` sink (wired in main.ts to fire only when
`debugLogging` is on), and `HookRunner` run-outcome traces route through the already-gated
`hookLogger.info`. Default: clean console. `debugLogging` on: concise per-run traces
(including the hooks-dir path that diagnosed #52). Always-on signals stay (`.js`-ignored,
vault-escape, malformed-hook warnings) plus the `[hashi] run aborted before finalize:`
console.error.

<!-- 2026-08-31 -->
## Dependabot alert stays open although the parent's range already allows the patch
**Symptom:** `npm audit fix` / `npm update <pkg>` report "fix available" but leave the package
at the vulnerable version — even after deleting its `package-lock.json` entry and re-resolving.
**Cause:** `package.json` `overrides` pinned that package to an **exact** version (`"fast-uri":
"3.1.2"`, `"protobufjs": "7.6.3"`) in an earlier CVE round. The pin outlives the CVE it fixed and
then becomes the thing that blocks the next patch — npm honours the override over every parent
range, so no update path exists.
**How to apply:** when a transitive alert refuses to move, check `overrides` **before** the
lockfile. Bump the override to the patched version and prefer a caret inside the major the
parents require (`^3.1.6`, not `3.1.6`) so the next patch lands on its own. Note that
`node_modules/npm/node_modules/*` alerts (bundled npm inside `@semantic-release/npm`) are a
different class — those need a wrapper bump, not an override.

<!-- 2026-08-31 -->
## Every Dependabot npm PR fails CI with `npm ci` EUSAGE "Missing: esbuild@… from lock file"
**Symptom:** each Dependabot npm PR — even ones that touch neither esbuild nor vitest — dies in
the `npm ci` step with `package.json and package-lock.json are not in sync` and a long
`Missing: @esbuild/<platform>@0.28.1` list. `@dependabot rebase` reports "already up-to-date"
and changes nothing; `@dependabot recreate` reproduces the same failure.
**Cause:** a **nested** override in `package.json` (`"vitest": { "esbuild": "0.28.1" }`).
Dependabot's resolver does not honour nested overrides, so the lockfile it generates lacks the
`node_modules/vitest/node_modules/esbuild` entry that `npm ci` then demands. The override was
also obsolete: `vitest → vite@8` declares `esbuild ^0.27.0 || ^0.28.0` and resolves 0.28.1 on
its own — dropping the override leaves `package-lock.json` byte-identical.
**How to apply:** prefer a flat override over a nested one; before adding either, check whether
the parent's own range already reaches the patched version. If a nested override is genuinely
unavoidable, expect to regenerate Dependabot's lockfiles by hand.
**Do not "fix" this by regenerating the lockfile from scratch** (`rm package-lock.json &&
npm install`) in the Linux dev container: that drops the `@esbuild/*` / `@rollup/*` optional
platform packages for every other platform (~12k-line diff) and breaks `npm ci` on macOS.
Restore the lockfile from `main` and run a plain `npm install` instead.
