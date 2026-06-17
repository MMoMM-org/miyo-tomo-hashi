/**
 * FakeVaultFS — contract tests.
 *
 * Runs the shared VaultFS contract suite (proves all methods behave correctly).
 */

import { describe } from "vitest";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS.js";
import { runContractTests } from "./VaultFS.contract.test.js";

describe("FakeVaultFS", () => {
  runContractTests(() => new FakeVaultFS());
});
