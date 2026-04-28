# Tools Memory

<!-- 2026-04-28 -->
- **Obsidian's `Plugin` class is `abstract` — code that needs to be testable against the obsidian mock should depend on a structural slice of `Plugin`, not the class itself.**
  `import { Plugin } from "obsidian"; new Plugin()` does not type-check (abstract). Vitest's mock can construct it at runtime via `test/__mocks__/obsidian.ts` (where `Plugin` is a concrete `vi.fn`-equipped class), but `tsc -noEmit` resolves the real `node_modules/obsidian` types and rejects the call. The same trap exists for any helper that types its argument as `Plugin` and is consumed in tests.
  - **Why:** the dual resolution (vitest aliases `obsidian` → mock, tsc resolves to real types) means the mock-compatible production type must be a structural subset of `Plugin`, not the abstract class itself. A `Pick<Plugin, "loadData" | "saveData">` alias works because both real `Plugin` and the mock satisfy it structurally.
  - **How to apply:** when writing a helper that needs `loadData` / `saveData` / a small slice of the Plugin surface, declare a local type alias `type PluginDataHost = Pick<Plugin, "loadData" | "saveData">` and use that as the parameter type. The actual `main.ts` wire-up passes `this` and satisfies the alias structurally; tests construct the mock `Plugin` and pass it in. Real example: `src/connection/settingsPersistence.ts` (commit `4072675`).
