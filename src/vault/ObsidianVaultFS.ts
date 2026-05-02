/**
 * ObsidianVaultFS — production VaultFS adapter.
 *
 * Delegates every vault operation to the live Obsidian app instance.
 * Implementation notes:
 *   - rename: uses fileManager.renameFile (NOT vault.rename) to preserve backlinks
 *   - trash:  calls vault.trash(file, true) — system trash flag (per SDD decision;
 *             the obsidianmd/prefer-file-manager-trash-file lint rule is suppressed
 *             here because the SDD explicitly mandates vault.trash with the system
 *             trash flag for v0.1)
 *   - createFolder: swallows "already exists" per port contract
 *   - process/processJSON: delegates to vault.process for Obsidian's built-in
 *     atomic read-transform-write with per-path serialisation
 *
 * [ref: SDD/Implementation Gotchas; VaultFS Port]
 */

import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { FileMetadata, VaultFS } from "./VaultFS.js";

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

  async metadata(path: string): Promise<FileMetadata | null> {
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (!(abstractFile instanceof TFile)) return null;
    const cache = this.app.metadataCache.getFileCache(abstractFile);
    if (cache === null) return null;
    return {
      headings: (cache.headings ?? []).map(
        (h: {
          heading: string;
          level: number;
          position: { start: { line: number } };
        }) => ({
          heading: h.heading,
          level: h.level,
          line: h.position.start.line,
        }),
      ),
      sections: (cache.sections ?? []).map(
        (s: {
          type: string;
          position: { start: { line: number }; end: { line: number } };
        }) => ({
          type: s.type,
          line: s.position.start.line,
          endLine: s.position.end.line,
        }),
      ),
    };
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
    // SDD mandates vault.trash(file, true) — system trash flag for v0.1.
    // eslint-disable-next-line obsidianmd/prefer-file-manager-trash-file
    await this.app.vault.trash(file, true);
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
