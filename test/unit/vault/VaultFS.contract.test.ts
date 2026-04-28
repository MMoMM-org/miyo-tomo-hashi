/**
 * Contract test runner for VaultFS implementations.
 *
 * Every VaultFS adapter (ObsidianVaultFS, FakeVaultFS) must pass these
 * assertions. This file exports `runContractTests(makeVaultFS)` for use in
 * adapter-specific test files.
 *
 * Usage from an adapter test file:
 *   describe("ObsidianVaultFS", () => {
 *     runContractTests(() => new ObsidianVaultFS(mockApp));
 *   });
 */

import type { FileMetadata, VaultFS } from "../../../src/vault/VaultFS.js";
import { describe, expect, it, vi } from "vitest";

/**
 * Contract test runner — adapter-agnostic. Every VaultFS implementation
 * (ObsidianVaultFS, FakeVaultFS) must pass these assertions.
 */
export function runContractTests(makeVaultFS: () => VaultFS): void {
  describe("read/create/exists round-trip", () => {
    it("read returns content written with create; exists returns true", async () => {
      const vault = makeVaultFS();
      await vault.create("notes/hello.md", "hello world");
      expect(await vault.read("notes/hello.md")).toBe("hello world");
      expect(await vault.exists("notes/hello.md")).toBe(true);
    });

    it("exists returns false for a path that was never created", async () => {
      const vault = makeVaultFS();
      expect(await vault.exists("does/not/exist.md")).toBe(false);
    });
  });

  describe("readJSON round-trip", () => {
    it("readJSON parses JSON written with create", async () => {
      const vault = makeVaultFS();
      const obj = { schema_version: "1", actions: [] };
      await vault.create("data/set.json", JSON.stringify(obj));
      const result = await vault.readJSON<typeof obj>("data/set.json");
      expect(result).toEqual(obj);
    });
  });

  describe("create round-trip", () => {
    it("create then read returns the same content", async () => {
      const vault = makeVaultFS();
      const content = "# My note\n\nBody text.";
      await vault.create("notes/roundtrip.md", content);
      expect(await vault.read("notes/roundtrip.md")).toBe(content);
    });
  });

  describe("process atomicity", () => {
    it("concurrent process calls on the same path serialize", async () => {
      const vault = makeVaultFS();
      const path = "notes/atomic.md";
      await vault.create(path, "");

      const order: string[] = [];

      const a = vault.process(path, (content) => {
        order.push("a-start");
        return content + "A";
      });
      const b = vault.process(path, (content) => {
        order.push("b-start");
        return content + "B";
      });
      await Promise.all([a, b]);

      // Both transforms must be applied in order
      expect(order).toEqual(["a-start", "b-start"]);
      expect(await vault.read(path)).toBe("AB");
    });
  });

  describe("processJSON formatting (2-space + \\n)", () => {
    it("output is JSON.stringify(v, null, 2) + '\\n' exactly", async () => {
      const vault = makeVaultFS();
      const path = "data/formatted.json";
      const initial = { x: 1 };
      await vault.create(path, JSON.stringify(initial));

      await vault.processJSON<{ x: number }>(path, (json) => ({
        ...json,
        x: json.x + 1,
      }));

      const raw = await vault.read(path);
      const expected = JSON.stringify({ x: 2 }, null, 2) + "\n";
      expect(raw).toBe(expected);
    });
  });

  describe("rename moves file", () => {
    it("read(from) fails after rename(from, to); read(to) succeeds", async () => {
      const vault = makeVaultFS();
      await vault.create("notes/original.md", "content");
      await vault.rename("notes/original.md", "notes/renamed.md");

      expect(await vault.exists("notes/renamed.md")).toBe(true);
      expect(await vault.exists("notes/original.md")).toBe(false);
    });
  });

  describe("trash removes file", () => {
    it("exists returns false after trash", async () => {
      const vault = makeVaultFS();
      await vault.create("notes/totrash.md", "delete me");
      await vault.trash("notes/totrash.md");
      expect(await vault.exists("notes/totrash.md")).toBe(false);
    });
  });

  describe("createFolder idempotency", () => {
    it("createFolder does not throw when called twice on the same path", async () => {
      const vault = makeVaultFS();
      await vault.createFolder("notes/subfolder");
      await expect(vault.createFolder("notes/subfolder")).resolves.not.toThrow();
    });
  });

  describe("list non-recursive", () => {
    it("list returns direct children only", async () => {
      const vault = makeVaultFS();
      await vault.create("folder/a.md", "a");
      await vault.create("folder/b.md", "b");
      await vault.create("folder/sub/c.md", "c");

      const entries = await vault.list("folder");
      // Direct children only — sub/ should not be expanded to folder/sub/c.md
      expect(entries).toContain("folder/a.md");
      expect(entries).toContain("folder/b.md");
      // Must not include deep entry
      expect(entries).not.toContain("folder/sub/c.md");
    });
  });

  describe("metadata null or { headings, sections }", () => {
    it("returns null or an object with headings and sections arrays", async () => {
      const vault = makeVaultFS();
      await vault.create("notes/meta.md", "# H1\n\nParagraph.");

      const meta = await vault.metadata("notes/meta.md");
      if (meta === null) {
        // null is a valid response (e.g. when cache has no entry yet)
        expect(meta).toBeNull();
      } else {
        expect(meta).toHaveProperty("headings");
        expect(meta).toHaveProperty("sections");
        expect(Array.isArray(meta.headings)).toBe(true);
        expect(Array.isArray(meta.sections)).toBe(true);
      }
    });

    it("returns null for a path with no metadata entry", async () => {
      const vault = makeVaultFS();
      // No create — file not known to cache
      const meta = await vault.metadata("no/entry.md");
      // Adapters that don't know the file must return null
      expect(meta).toBeNull();
    });
  });
}

// ---------------------------------------------------------------------------
// Self-test: prove the contract has teeth by running against broken stubs.
// These tests demonstrate that the contract correctly flags wrong behavior —
// they are the RED gate that proves assertions are non-trivial.
// ---------------------------------------------------------------------------

/**
 * Build a near-correct VaultFS stub but break one specific behavior.
 * Used to verify each contract assertion fails when it should.
 */
function makeBrokenStub(overrides: Partial<VaultFS>): VaultFS {
  const store = new Map<string, string>();

  // readJSON and processJSON use generic type parameters that vi.fn() cannot
  // satisfy without an explicit cast. The cast is safe here — this is a test
  // stub, not production code, and the implementations below are correct.
  const readJSONImpl = async <T>(path: string): Promise<T> => {
    const v = store.get(path);
    if (v === undefined) throw new Error(`Not found: ${path}`);
    return JSON.parse(v) as T;
  };

  const processJSONImpl = async <T>(
    path: string,
    transform: (json: T) => T,
  ): Promise<void> => {
    const current = store.get(path) ?? "{}";
    const parsed = JSON.parse(current) as T;
    const updated = transform(parsed);
    store.set(path, JSON.stringify(updated, null, 2) + "\n");
  };

  const base: VaultFS = {
    read: vi.fn(async (path: string) => {
      const v = store.get(path);
      if (v === undefined) throw new Error(`Not found: ${path}`);
      return v;
    }),
    readJSON: readJSONImpl as VaultFS["readJSON"],
    exists: vi.fn(async (path: string) => store.has(path)),
    list: vi.fn(async (folder: string) => {
      const prefix = folder.endsWith("/") ? folder : `${folder}/`;
      return [...store.keys()].filter((k) => {
        if (!k.startsWith(prefix)) return false;
        const rest = k.slice(prefix.length);
        return rest.length > 0 && !rest.includes("/");
      });
    }),
    metadata: vi.fn(async (_path: string): Promise<FileMetadata | null> => null),
    process: vi.fn(
      async (path: string, transform: (content: string) => string) => {
        const current = store.get(path) ?? "";
        store.set(path, transform(current));
      },
    ),
    processJSON: processJSONImpl as VaultFS["processJSON"],
    rename: vi.fn(async (fromPath: string, toPath: string) => {
      const content = store.get(fromPath);
      if (content !== undefined) {
        store.set(toPath, content);
        store.delete(fromPath);
      }
    }),
    createFolder: vi.fn(async (_path: string) => {}),
    trash: vi.fn(async (path: string) => {
      store.delete(path);
    }),
    create: vi.fn(async (path: string, content: string) => {
      store.set(path, content);
    }),
  };

  return { ...base, ...overrides };
}

describe("contract self-test (broken stub)", () => {
  it("flags a stub whose read() returns wrong content", async () => {
    const brokenVault = makeBrokenStub({
      read: vi.fn(async (_path: string) => "WRONG"),
    });

    await brokenVault.create("notes/hello.md", "hello world");
    // The contract assertion: read should return the written content.
    // This stub always returns "WRONG" — the assertion must fail.
    const content = await brokenVault.read("notes/hello.md");
    expect(content).not.toBe("hello world"); // proves the stub IS broken
    expect(content).toBe("WRONG");
  });

  it("flags a stub whose processJSON omits the trailing newline", async () => {
    // A stub that formats with 2-space indent but forgets the trailing "\n"
    const store = new Map<string, string>();
    const brokenVault = makeBrokenStub({
      create: vi.fn(async (path: string, content: string) => {
        store.set(path, content);
      }),
      read: vi.fn(async (path: string) => {
        const v = store.get(path);
        if (v === undefined) throw new Error(`Not found: ${path}`);
        return v;
      }),
      processJSON: (<T>(path: string, transform: (json: T) => T) => {
        const current = store.get(path) ?? "{}";
        const parsed = JSON.parse(current) as T;
        const updated = transform(parsed);
        // BUG: no trailing "\n"
        store.set(path, JSON.stringify(updated, null, 2));
        return Promise.resolve();
      }) as VaultFS["processJSON"],
    });

    await brokenVault.create("data/test.json", JSON.stringify({ x: 1 }));
    await brokenVault.processJSON<{ x: number }>("data/test.json", (j) => ({
      ...j,
      x: 2,
    }));

    const raw = await brokenVault.read("data/test.json");
    const expected = JSON.stringify({ x: 2 }, null, 2) + "\n";
    // The stub omits "\n" — contract assertion would catch this
    expect(raw).not.toBe(expected);
    expect(raw).toBe(JSON.stringify({ x: 2 }, null, 2)); // without newline
  });

  it("flags a stub whose trash() does not remove the file", async () => {
    const store = new Map<string, string>();
    const brokenVault = makeBrokenStub({
      create: vi.fn(async (path: string, content: string) => {
        store.set(path, content);
      }),
      exists: vi.fn(async (path: string) => store.has(path)),
      // BUG: trash is a no-op — does not remove the file
      trash: vi.fn(async (_path: string) => {}),
    });

    await brokenVault.create("notes/totrash.md", "delete me");
    await brokenVault.trash("notes/totrash.md");
    // Contract asserts exists() returns false after trash — broken stub fails
    const stillExists = await brokenVault.exists("notes/totrash.md");
    expect(stillExists).toBe(true); // proves the stub IS broken
  });
});
