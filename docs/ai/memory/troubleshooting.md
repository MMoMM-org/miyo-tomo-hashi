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
