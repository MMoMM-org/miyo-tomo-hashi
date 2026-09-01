/**
 * FakeVaultFS — in-memory VaultFS adapter for tests.
 *
 * Implements every VaultFS method using a plain Map<path, string> for
 * content and a per-path Promise queue for serialised process() calls.
 *
 * Frontmatter is held in a SEPARATE parsed map rather than being extracted
 * from the content string — this is a fake, not a YAML implementation, and
 * teaching it to parse YAML would ship a parser dependency to serve tests. The
 * consequence is deliberate and worth knowing: round-trip fidelity (comment
 * survival, key order, how Obsidian serialises a list, whether a no-op write
 * reformats) is NOT covered by unit tests and has to be verified in the test
 * vault against the real API. Seed with `seedFrontMatter`.
 *
 * [ref: SDD/Architecture Decisions; ADR-9 v2; VaultFS Port]
 */

import type { VaultFS } from "./VaultFS.js";

export class FakeVaultFS implements VaultFS {
  private readonly content = new Map<string, string>();
  private readonly folders = new Set<string>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly frontmatter = new Map<string, Record<string, unknown>>();

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

  async readFrontMatter(path: string): Promise<Record<string, unknown> | undefined> {
    if (!this.content.has(path)) throw new Error(`File not found: ${path}`);
    const fm = this.frontmatter.get(path);
    return fm === undefined ? undefined : { ...fm };
  }

  async processFrontMatter(
    path: string,
    fn: (fm: Record<string, unknown>) => void,
  ): Promise<void> {
    // Same per-path queue as process(), so a frontmatter write and a body
    // write on one file serialise against each other as they do in Obsidian.
    const prior = this.queues.get(path) ?? Promise.resolve();
    const next = prior.then(async () => {
      if (!this.content.has(path)) throw new Error(`File not found: ${path}`);
      // A note with no frontmatter block yields {} — mutating it is what
      // creates the block, mirroring Obsidian.
      const fm = this.frontmatter.get(path) ?? {};
      fn(fm);
      this.frontmatter.set(path, fm);
    });
    this.queues.set(path, next);
    await next;
  }

  /**
   * Test-only seam: set a file's parsed frontmatter directly. Not part of the
   * VaultFS port — the real adapter derives this from the file's YAML.
   */
  seedFrontMatter(path: string, fm: Record<string, unknown>): void {
    this.frontmatter.set(path, { ...fm });
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    const v = this.content.get(fromPath);
    if (v === undefined) throw new Error(`File not found: ${fromPath}`);
    this.content.set(toPath, v);
    this.content.delete(fromPath);
    // Frontmatter follows the file, as it does on disk.
    const fm = this.frontmatter.get(fromPath);
    if (fm !== undefined) {
      this.frontmatter.set(toPath, fm);
      this.frontmatter.delete(fromPath);
    }
  }

  async createFolder(path: string): Promise<void> {
    // idempotent — Set.add never throws on an existing value
    this.folders.add(path);
  }

  async trash(path: string): Promise<void> {
    this.content.delete(path);
    this.frontmatter.delete(path);
  }

  async create(path: string, content: string): Promise<void> {
    if (this.content.has(path)) {
      throw new Error(`File already exists: ${path}`);
    }
    this.content.set(path, content);
  }
}
