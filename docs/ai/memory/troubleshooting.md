# Troubleshooting Memory

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
