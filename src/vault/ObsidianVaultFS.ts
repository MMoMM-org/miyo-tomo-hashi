/**
 * ObsidianVaultFS — production VaultFS adapter.
 *
 * Delegates every vault operation to the live Obsidian app instance.
 * Implementation notes:
 *   - rename: uses fileManager.renameFile (NOT vault.rename) to preserve backlinks
 *   - trash:  calls fileManager.trashFile(file) — honors the user's "Deleted
 *             files" preference (system trash / .trash / permanent) per the
 *             obsidianmd/prefer-file-manager-trash-file lint rule. Supersedes
 *             the v0.1 SDD note that forced system trash (Kokoro decision
 *             2026-06-12; Spec 002 F4 amendment). The executor warns once when
 *             that preference is "Permanently delete".
 *   - createFolder: swallows "already exists" per port contract
 *   - process/processJSON: delegates to vault.process for Obsidian's built-in
 *     atomic read-transform-write with per-path serialisation
 *
 * [ref: SDD/Implementation Gotchas; VaultFS Port]
 */

import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { VaultFS } from "./VaultFS.js";

export class ObsidianVaultFS implements VaultFS {
  constructor(private readonly app: App) {}

  async read(path: string): Promise<string> {
    const file = this.requireFile(path);
    return await this.app.vault.read(file);
  }

  async cachedRead(path: string): Promise<string> {
    // L8: prefer Obsidian's editor-aware read for pre-flight checks. If
    // the file is open in an editor, returns the in-memory content
    // (cheaper than disk); otherwise falls through to a normal read.
    const file = this.requireFile(path);
    return await this.app.vault.cachedRead(file);
  }

  async readJSON<T = unknown>(path: string): Promise<T> {
    const text = await this.read(path);
    return JSON.parse(text) as T;
  }

  async exists(path: string): Promise<boolean> {
    return this.app.vault.getAbstractFileByPath(path) !== null;
  }

  async list(folder: string): Promise<readonly string[]> {
    const entry = this.app.vault.getAbstractFileByPath(folder);
    if (entry === null || !("children" in entry)) return [];
    const children = (entry as { children: ReadonlyArray<{ path: string }> })
      .children;
    return children.map((c) => c.path);
  }

  async process(
    path: string,
    transform: (content: string) => string,
  ): Promise<void> {
    const file = this.requireFile(path);
    await this.app.vault.process(file, transform);
  }

  async processJSON<T>(
    path: string,
    transform: (json: T) => T,
  ): Promise<void> {
    await this.process(path, (raw) => {
      const parsed = JSON.parse(raw) as T;
      const updated = transform(parsed);
      // 2-space indent + trailing newline per ADR-7
      return JSON.stringify(updated, null, 2) + "\n";
    });
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    const file = this.requireFile(fromPath);
    // fileManager.renameFile preserves backlinks; vault.rename does not
    await this.app.fileManager.renameFile(file, toPath);
  }

  async createFolder(path: string): Promise<void> {
    // L5: pre-check via getAbstractFileByPath — Obsidian doesn't expose a
    // typed error code for "folder already exists", and the message-string
    // match was fragile across locales / Obsidian versions. The
    // getAbstractFileByPath probe is cheap (metadata-only) and lets the
    // catch only fire on real failure.
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing !== null) return;
    await this.app.vault.createFolder(path);
  }

  async trash(path: string): Promise<void> {
    const file = this.requireFile(path);
    // fileManager.trashFile honors the user's "Deleted files" preference
    // (system trash / .trash folder / permanent). obsidianmd lint requires it
    // over vault.trash. Supersedes the v0.1 SDD note that forced system trash —
    // SDD update flagged to Kokoro.
    await this.app.fileManager.trashFile(file);
  }

  async create(path: string, content: string): Promise<void> {
    await this.app.vault.create(path, content);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private requireFile(path: string): TFile {
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (!(abstractFile instanceof TFile)) {
      throw new Error(`File not found: ${path}`);
    }
    return abstractFile;
  }
}
