/**
 * VaultFS port — vault edge abstraction (ports-and-adapters pattern).
 *
 * Every vault read/write goes through this interface. Adapters:
 *   - ObsidianVaultFS (production): delegates to app.vault, app.fileManager, app.metadataCache
 *   - FakeVaultFS (tests): in-memory Map<path, string> with per-path Promise queue
 *
 * Contract tests live in test/unit/vault/VaultFS.contract.test.ts.
 *
 * [ref: SDD/Interface Specifications; VaultFS Port (port/adapter pattern)]
 */

export interface VaultFS {
  // Reads

  /** Read the raw string content of a file. Throws if the file does not exist. */
  read(path: string): Promise<string>;

  /**
   * Read-only fast path (review L8). Returns the latest in-memory content
   * of the file if Obsidian has it open in an editor; otherwise reads from
   * disk. Use for pre-flight idempotency checks where staleness is
   * acceptable — `process` always reads fresh disk state when it commits.
   *
   * Falls back to `read` semantics in adapters that have no caching layer
   * (FakeVaultFS, etc.).
   */
  cachedRead(path: string): Promise<string>;

  /** Read and parse a JSON file. Throws if the file does not exist or is not valid JSON. */
  readJSON<T = unknown>(path: string): Promise<T>;

  /** Return true iff the file (or folder) at `path` exists. */
  exists(path: string): Promise<boolean>;

  /** List the non-recursive direct children of `folder`. Returns paths relative to vault root. */
  list(folder: string): Promise<readonly string[]>;

  // Writes (atomic at the file level)

  /**
   * Atomically read-transform-write a file. Concurrent calls on the same path
   * serialize — later calls see the result of earlier transforms.
   *
   * [ref: SDD/Architecture Decisions; ADR-7]
   */
  process(path: string, transform: (content: string) => string): Promise<void>;

  /**
   * A note's PARSED frontmatter without opening a write. `undefined` means the
   * note has no frontmatter block at all — distinct from an empty one.
   *
   * Exists so a handler can decide NOT to call `processFrontMatter`. That call
   * re-serialises the whole block whether or not the callback mutates
   * anything, and Obsidian's serialiser does not preserve YAML comments — so
   * entering it to then refuse to write costs the user their comments for
   * nothing.
   *
   * Best-effort, and deliberately so: this is backed by the metadata cache,
   * which lags during the multi-action batches that bit us in #68. The
   * staleness only ever fails in the SAFE direction — a stale read can make a
   * write be skipped (reported as a failure the user re-runs), never make a
   * wrong write happen, because the authoritative comparison still runs inside
   * the `processFrontMatter` callback.
   */
  readFrontMatter(path: string): Promise<Record<string, unknown> | undefined>;

  /**
   * Atomically read-mutate-write a note's YAML frontmatter, mirroring
   * Obsidian's `FileManager.processFrontMatter`. `fm` is the PARSED
   * frontmatter object: mutate keys on it, or `delete fm[key]` to remove one.
   * A file with no frontmatter block yields an empty object, and adding a key
   * creates the block.
   *
   * Structural, not textual — this is the only safe way to edit YAML. Doing it
   * through `process` would mean literal string surgery on a parsed format,
   * which is how documents get corrupted.
   *
   * Markdown only: Obsidian documents this as "Must be a Markdown file".
   * Callers guard with `isMarkdown` from `util/paths` before invoking.
   *
   * Throws on malformed YAML (Obsidian raises `YAMLParseError`); handlers turn
   * that into a `failed` outcome rather than letting it abort the run.
   *
   * [ref: SDD/Architecture Decisions; ADR-7]
   */
  processFrontMatter(
    path: string,
    fn: (fm: Record<string, unknown>) => void,
  ): Promise<void>;

  /**
   * Convenience wrapper around `process` that parses JSON before calling
   * `transform` and re-serialises the result with
   * `JSON.stringify(v, null, 2) + "\n"` (2-space indent, trailing newline).
   *
   * [ref: SDD/Architecture Decisions; ADR-7]
   */
  processJSON<T>(path: string, transform: (json: T) => T): Promise<void>;

  /**
   * Move/rename a file from `fromPath` to `toPath` in a link-preserving way.
   * On the Obsidian adapter this calls `fileManager.renameFile` (NOT `vault.rename`)
   * to ensure Obsidian updates backlinks.
   *
   * [ref: SDD/Implementation Gotchas; fileManager.renameFile]
   */
  rename(fromPath: string, toPath: string): Promise<void>;

  /**
   * Create a folder. Tolerate an already-exists condition — do not throw.
   *
   * [ref: PRD/F4; SDD/Implementation Gotchas; createFolder already-exists]
   */
  createFolder(path: string): Promise<void>;

  /**
   * Delete the file, honoring the user's Obsidian "Files & Links → Deleted
   * files" preference (system trash / vault-local `.trash/` / permanent). On
   * the Obsidian adapter this calls `fileManager.trashFile(file)` — NOT
   * `vault.trash`, per the obsidianmd lint rule. When the user's preference is
   * "Permanently delete", the file is hard-deleted; the executor surfaces a
   * one-time warning for that case (Spec 002 F4 amendment).
   *
   * [ref: PRD/F4; Kokoro decision 2026-06-12; SDD/Implementation Gotchas]
   */
  trash(path: string): Promise<void>;

  /**
   * Create a new file at `path` with the given `content`.
   * Used for run log file creation.
   */
  create(path: string, content: string): Promise<void>;
}
