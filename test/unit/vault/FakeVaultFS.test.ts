/**
 * FakeVaultFS — contract + injection tests.
 *
 * Runs the shared VaultFS contract suite (proves all 11 methods behave
 * correctly) and verifies the metadata-injection constructor argument.
 */

import { describe, expect, it } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import type { FileMetadata } from "../../../src/vault/VaultFS.js";
import { runContractTests } from "./VaultFS.contract.test.js";

describe("FakeVaultFS", () => {
  runContractTests(() => new FakeVaultFS());

  describe("metadata injection", () => {
    it("returns the constructor-injected fake when provided", async () => {
      const meta: FileMetadata = {
        headings: [{ heading: "H1", level: 1, line: 0 }],
        sections: [{ type: "paragraph", line: 2, endLine: 4 }],
      };
      const fake = new FakeVaultFS(new Map([["notes/foo.md", meta]]));
      expect(await fake.metadata("notes/foo.md")).toEqual(meta);
    });

    it("returns null for a path not in the injected map", async () => {
      const fake = new FakeVaultFS();
      expect(await fake.metadata("notes/missing.md")).toBeNull();
    });
  });
});
