/**
 * FakeVaultFS — in-memory VaultFS adapter for tests.
 *
 * Implements every VaultFS method using a plain Map<path, string> for
 * content and a per-path Promise queue for serialised process() calls.
 *
 * [ref: SDD/Architecture Decisions; ADR-9 v2; VaultFS Port]
 */

import type { VaultFS } from "./VaultFS.js";

export class FakeVaultFS implements VaultFS {
  private readonly content = new Map<string, string>();
  private readonly folders = new Set<string>();
  private readonly queues = new Map<string, Promise<void>>();

  async read(path: string): Promise<string> {
    const v = this.content.get(path);
    if (v === undefined) throw new Error(`File not found: ${path}`);
    return v;
  }

  // L8: no caching layer in tests — alias to read. Production
  // ObsidianVaultFS.cachedRead delegates to app.vault.cachedRead.
  async cachedRead(path: string): Promise<string> {
    return this.read(path);
  }

  async readJSON<T = unknown>(path: string): Promise<T> {
    return JSON.parse(await this.read(path)) as T;
  }

  async exists(path: string): Promise<boolean> {
    return this.content.has(path) || this.folders.has(path);
  }

  async list(folder: string): Promise<readonly string[]> {
    const prefix = folder === "" ? "" : `${folder}/`;
    const out: string[] = [];
    for (const path of this.content.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      // Direct children only — no path separators allowed in `rest`.
      if (!rest.includes("/")) out.push(path);
    }
    return out;
  }

  async process(
    path: string,
    transform: (content: string) => string,
  ): Promise<void> {
    const prior = this.queues.get(path) ?? Promise.resolve();
    const next = prior.then(async () => {
      const current = this.content.get(path) ?? "";
      this.content.set(path, transform(current));
    });
    this.queues.set(path, next);
    await next;
  }

  async processJSON<T>(
    path: string,
    transform: (json: T) => T,
  ): Promise<void> {
    await this.process(path, (raw) => {
      const parsed = JSON.parse(raw) as T;
      const updated = transform(parsed);
      return JSON.stringify(updated, null, 2) + "\n";
    });
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    const v = this.content.get(fromPath);
    if (v === undefined) throw new Error(`File not found: ${fromPath}`);
    this.content.set(toPath, v);
    this.content.delete(fromPath);
  }

  async createFolder(path: string): Promise<void> {
    // idempotent — Set.add never throws on an existing value
    this.folders.add(path);
  }

  async trash(path: string): Promise<void> {
    this.content.delete(path);
  }

  async create(path: string, content: string): Promise<void> {
    if (this.content.has(path)) {
      throw new Error(`File already exists: ${path}`);
    }
    this.content.set(path, content);
  }
}
