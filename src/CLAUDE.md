# src/ — Code Area Rules

Hashi source. The `obsidian` API is mocked in tests (`test/__mocks__/obsidian.ts`); production code must stay testable against that mock rather than the live Obsidian runtime.

## Where the rules already live — don't restate here
- TDD cycle, strict TS, `no any`, import order → enforced by `tcs-workflow:xdd-tdd`, ESLint (`eslint-plugin-obsidianmd`), and `tsconfig.json` (`strict` + `noUncheckedIndexedAccess`)
- Domain rules an implementation must honor → `docs/ai/memory/domain.md` (e.g. vault filename `:` → `-` sanitization)
- Architectural patterns to follow → `docs/ai/memory/decisions.md` (epoch-counter guard for async state machines; plan-wins-over-SDD on drift)
- Public interfaces must match the SDD contract in `docs/XDD/specs/<spec>/solution.md`

## Hashi-specific code traps (index into tools.md)
- `obsidian`'s `Plugin` is `abstract` — type helpers against a structural slice (`Pick<Plugin, "loadData" | "saveData">`), never `new Plugin()`.
- `Modal` / `SettingTab` do **not** extend `Component` → `registerDomEvent` is unavailable; attach listeners directly and clean them up by hand.
- User hooks load as `.cjs` only — Electron treats `.js` as ESM and `module.exports` comes back empty.
