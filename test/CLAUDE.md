# test/ — Test Area Rules

Vitest unit tests. Tests import explicitly from `vitest` (no globals) and run against the obsidian mock in `test/__mocks__/obsidian.ts` — which needs a side-effect `import "obsidian"` so its `HTMLElement.prototype` shim installs.

## Naming
- File: `<module>.test.ts`, mirroring `src/` structure
- `describe('<unit>')` / `it('<behavior>')`

## Coverage (per MiYo Constitution L1 — Testing)
- Every public interface tested; happy path + at least one failure/denial path
- Permission, validation, and instruction-set logic must prove BOTH authorization AND rejection

## Test data
- Fakes/factories over a live Obsidian UI; each test builds its own state — no shared mutable fixtures
- `tsconfig.json` `include` must cover `test/**/*.ts` so `tsc -noEmit` type-checks the test surface (vitest's own resolver won't; see `docs/ai/memory/general.md`)
