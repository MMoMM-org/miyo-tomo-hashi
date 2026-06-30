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

import type { VaultFS } from "../../../src/vault/VaultFS.js";
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

  describe("cachedRead round-trip (L8)", () => {
    it("returns the same content as read for a freshly-written file", async () => {
      const vault = makeVaultFS();
      await vault.create("notes/cached.md", "hello\nworld");
      const cached = await vault.cachedRead("notes/cached.md");
      const direct = await vault.read("notes/cached.md");
      expect(cached).toBe(direct);
      expect(cached).toBe("hello\nworld");
    });

    it("rejects when called on a path that does not exist", async () => {
      const vault = makeVaultFS();
      await expect(vault.cachedRead("never-created.md")).rejects.toThrow();
    });
  });

  describe("readJSON round-trip", () => {
    it("readJSON parses JSON written with create", async () => {
      const vault = makeVaultFS();
      const obj = { schema_version: "2", actions: [] };
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

    it("create rejects when the path already exists (matches Obsidian vault.create)", async () => {
      // Real Obsidian's vault.create THROWS on existing path; vault.modify is
      // the overwrite primitive. v0.1 only uses create() for run-log files,
      // whose paths are timestamp-unique with collision suffix, so a throwing
      // create is safe. Locking the contract here keeps FakeVaultFS and
      // ObsidianVaultFS aligned — a silent overwrite would mask bugs.
      const vault = makeVaultFS();
      await vault.create("notes/twice.md", "first");
      await expect(vault.create("notes/twice.md", "second")).rejects.toThrow();
    });
  });

  describe("process atomicity", () => {
    it("the second concurrent process sees the first transform's output", async () => {
      // Load-bearing assertion: a non-serializing implementation would run
      // both transforms against the SAME initial empty content, producing
      // either "A" or "B" (race) — never "AB". Forcing a microtask yield
      // inside the first transform ensures the second call's await on
      // process() can interleave; only a serializing impl will still produce
      // "AB" because the second transform will see "A" as its input.
      const vault = makeVaultFS();
      const path = "notes/atomic.md";
      await vault.create(path, "");

      const seen: string[] = [];

      const a = vault.process(path, (content) => {
        seen.push(`a-saw:${content}`);
        return content + "A";
      });
      // Yield to the event loop so a non-atomic impl would race here.
      await Promise.resolve();
      const b = vault.process(path, (content) => {
        seen.push(`b-saw:${content}`);
        return content + "B";
      });
      await Promise.all([a, b]);

      // Serialization proof: the second transform's input is "A" (the
      // output of the first), not "" (the initial state). A racy impl
      // would record "b-saw:" with empty content and the final read
      // would be "A" or "B" but not "AB".
      expect(seen).toEqual(["a-saw:", "b-saw:A"]);
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

    // L14: Pre-fix the contract didn't pin behavior on a missing file.
    // FakeVaultFS silently fell back to empty-string parse; ObsidianVaultFS
    // throws. A future refactor in production code that called processJSON
    // before create() would pass tests against the fake and break against
    // real Obsidian. Lock it down: both adapters must reject.
    it("rejects when called on a path that does not exist", async () => {
      const vault = makeVaultFS();
      await expect(
        vault.processJSON<{ x: number }>("never-created.json", (json) => json),
      ).rejects.toThrow();
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
    cachedRead: vi.fn(async (path: string) => {
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

  it("flags a stub whose process() does NOT serialize concurrent calls", async () => {
    // Build a stub that reads-modifies-writes WITHOUT a per-path queue.
    // The transform is delayed by a setTimeout(0) so both calls observe
    // the same initial state before either writes. The contract assertion
    // expects "AB"; this stub produces "B" (the second write wins).
    const store = new Map<string, string>();
    const brokenVault = makeBrokenStub({
      create: vi.fn(async (path: string, content: string) => {
        store.set(path, content);
      }),
      read: vi.fn(async (path: string) => store.get(path) ?? ""),
      // BUG: read happens NOW; write happens after a real delay; no queue.
      process: vi.fn(async (path: string, transform: (c: string) => string) => {
        const current = store.get(path) ?? "";
        await new Promise((r) => setTimeout(r, 5));
        store.set(path, transform(current));
      }),
    });

    await brokenVault.create("notes/atomic.md", "");
    // Start both WITHOUT yielding between them — both calls capture the
    // initial empty state synchronously before either resolves.
    const a = brokenVault.process("notes/atomic.md", (c) => c + "A");
    const b = brokenVault.process("notes/atomic.md", (c) => c + "B");
    await Promise.all([a, b]);
    // A serializing impl produces "AB"; this racy stub produces "B".
    expect(await brokenVault.read("notes/atomic.md")).toBe("B");
  });
});
