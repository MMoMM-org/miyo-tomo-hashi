/**
 * ObsidianVaultFS adapter test.
 *
 * Runs the shared contract tests (T2.1) against ObsidianVaultFS backed by a
 * richly-mocked Obsidian app, then verifies delegation specifics:
 *   - rename → fileManager.renameFile (NOT vault.rename)
 *   - trash  → fileManager.trashFile (honors user delete preference)
 *   - createFolder swallows "Folder already exists"
 */

import { App, TFile } from "obsidian";
import type { TFolder } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObsidianVaultFS } from "../../../src/vault/ObsidianVaultFS.js";
import { runContractTests } from "./VaultFS.contract.test.js";

// ---------------------------------------------------------------------------
// Rich app factory
// ---------------------------------------------------------------------------

/**
 * Build an App mock backed by an in-memory store.
 * Each call returns a fresh store/app so contract tests remain isolated.
 */
function makeRichApp(): App {
  const app = new App();

  // Single backing map — files keyed by path; folder sentinel keyed by __folder:<path>
  const store = new Map<string, string>();

  // Per-path serialisation queue for vault.process atomicity
  const queues = new Map<string, Promise<void>>();

  app.vault.getAbstractFileByPath = vi.fn((path: string) => {
    if (store.has(path)) {
      // Return a real TFile instance so instanceof TFile checks pass in adapter.
      const tfile = new TFile();
      tfile.path = path;
      tfile.name = path.split("/").pop() ?? path;
      return tfile;
    }
    // Empty folder created via createFolder() — tracked under __folder:<path>.
    if (store.has(`__folder:${path}`)) {
      return { path, children: [] } as unknown as TFolder;
    }
    // Folder: return folder-like object when any stored path starts with "<path>/"
    const prefix = `${path}/`;
    const isFolder = [...store.keys()].some(
      (k) => k.startsWith(prefix) && !k.startsWith("__folder:"),
    );
    if (isFolder) {
      const children = [...store.keys()]
        .filter(
          (k) =>
            k.startsWith(prefix) &&
            !k.startsWith("__folder:") &&
            !k.slice(prefix.length).includes("/"),
        )
        .map((k) => ({ path: k }));
      return { path, children } as unknown as TFolder;
    }
    return null;
  });

  app.vault.read = vi.fn(async (file: TFile) => {
    const v = store.get(file.path);
    if (v === undefined) throw new Error(`File not found: ${file.path}`);
    return v;
  });

  // L8: cachedRead returns the same content as read in the test mock
  // (no real editor cache to consult).
  app.vault.cachedRead = vi.fn(async (file: TFile) => {
    const v = store.get(file.path);
    if (v === undefined) throw new Error(`File not found: ${file.path}`);
    return v;
  });

  app.vault.create = vi.fn(async (path: string, content: string) => {
    if (store.has(path)) throw new Error(`File already exists: ${path}`);
    store.set(path, content);
    return { path } as TFile;
  });

  // Cast required: Obsidian's vault.process returns Promise<string> but our
  // mock returns void (return value unused by adapter). Type-safe at call site.
  (app.vault as unknown as { process: ReturnType<typeof vi.fn> }).process =
    vi.fn(
      async (file: TFile, transform: (content: string) => string) => {
        const path = file.path;
        const prior = queues.get(path) ?? Promise.resolve();
        const next = prior.then(() => {
          const current = store.get(path) ?? "";
          store.set(path, transform(current));
        });
        queues.set(path, next);
        await next;
      },
    );

  app.vault.trash = vi.fn(async (file: TFile, _useSystemTrash: boolean) => {
    store.delete(file.path);
  });

  // Cast required: Obsidian's vault.createFolder returns Promise<TFolder> but
  // our mock returns void. Adapter only awaits completion; return value unused.
  (
    app.vault as unknown as { createFolder: ReturnType<typeof vi.fn> }
  ).createFolder = vi.fn(async (path: string) => {
    const folderKey = `__folder:${path}`;
    if (store.has(folderKey)) {
      throw new Error("Folder already exists");
    }
    store.set(folderKey, "");
  });

  app.fileManager.renameFile = vi.fn(
    async (file: TFile, newPath: string) => {
      const content = store.get(file.path);
      if (content === undefined) throw new Error(`File not found: ${file.path}`);
      store.set(newPath, content);
      store.delete(file.path);
    },
  );

  app.fileManager.trashFile = vi.fn(async (file: TFile) => {
    store.delete(file.path);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Contract run
// ---------------------------------------------------------------------------

describe("ObsidianVaultFS", () => {
  runContractTests(() => new ObsidianVaultFS(makeRichApp()));

  // -------------------------------------------------------------------------
  // Delegation specifics
  // -------------------------------------------------------------------------

  describe("delegation specifics", () => {
    let app: App;
    let vault: ObsidianVaultFS;

    beforeEach(() => {
      app = makeRichApp();
      vault = new ObsidianVaultFS(app);
    });

    it("rename uses fileManager.renameFile, NOT vault.rename", async () => {
      await app.vault.create("notes/original.md", "content");
      await vault.rename("notes/original.md", "notes/renamed.md");

      expect(app.fileManager.renameFile).toHaveBeenCalledOnce();
      // vault does not even have a rename — but confirm fileManager was the path
      const [calledFile, calledNewPath] = (
        app.fileManager.renameFile as ReturnType<typeof vi.fn>
      ).mock.calls[0] as [TFile, string];
      expect(calledFile.path).toBe("notes/original.md");
      expect(calledNewPath).toBe("notes/renamed.md");
    });

    it("trash uses fileManager.trashFile — honors user delete preference", async () => {
      await app.vault.create("notes/totrash.md", "bye");
      await vault.trash("notes/totrash.md");

      expect(app.fileManager.trashFile).toHaveBeenCalledOnce();
      const [calledFile] = (
        app.fileManager.trashFile as ReturnType<typeof vi.fn>
      ).mock.calls[0] as [TFile];
      expect(calledFile.path).toBe("notes/totrash.md");
    });

    it("process uses app.vault.process", async () => {
      await app.vault.create("notes/proc.md", "init");
      await vault.process("notes/proc.md", (c) => c + "!");

      expect(app.vault.process).toHaveBeenCalledOnce();
    });

    it("processJSON uses app.vault.process", async () => {
      await app.vault.create("data/obj.json", JSON.stringify({ n: 1 }));
      await vault.processJSON<{ n: number }>("data/obj.json", (j) => ({
        n: j.n + 1,
      }));

      expect(app.vault.process).toHaveBeenCalledOnce();
    });

    it("createFolder swallows 'Folder already exists' on second call", async () => {
      await vault.createFolder("notes/sub");
      // Second call — mock throws "Folder already exists", adapter must swallow
      await expect(vault.createFolder("notes/sub")).resolves.not.toThrow();
    });

    it("createFolder re-throws non-exists errors", async () => {
      (app.vault.createFolder as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Permission denied"),
      );
      await expect(vault.createFolder("forbidden/dir")).rejects.toThrow(
        "Permission denied",
      );
    });
  });
});
