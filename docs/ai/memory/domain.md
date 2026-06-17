# Domain Memory

<!-- 2026-06-17 — supersedes the 2026-05-02 "sanitize" note below -->
- **Illegal filenames are rejected, not sanitized** — Obsidian rejects `\ / : * ? " < > |` inside a filename (its `renameFile`/`checkPath` throws). When a Tomo instruction targets a note name containing one of these, Hashi **fails that one action with a diagnostic naming the path + culprit char** (run continues, dependents cascade-skip) rather than silently rewriting the name. Silent sanitization (e.g. `:` → `-`) was rejected because dependent actions reference the destination by path (`link_to_moc.target_moc_path`); rewriting the MOC name would orphan those links. Clean names are Tomo's responsibility upstream. Implementation: `findIllegalFilenameChars()` in `src/util/paths.ts` (basename-only), called by `createMoc`/`moveNote`; a per-action `try/catch` in `InstructionExecutor` is the backstop so any handler throw becomes a logged `failed` row instead of an uncaught run abort.

<!-- 2026-05-02 — SUPERSEDED by the reject decision above; kept for context -->
- ~~**Vault filename sanitization**~~ — earlier plan was to sanitize incoming filenames by replacing `:` with `-` before any vault write. This was **not** adopted: see the reject-and-report decision above.
