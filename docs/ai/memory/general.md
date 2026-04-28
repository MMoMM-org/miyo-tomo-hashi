# General Memory

<!-- 2026-04-28 -->
- **`tsconfig.json` `include` must list `test/**/*.ts` from day 1.**
  Tests outside `include` cause LSP "Cannot find module" diagnostics on every new test file — vitest resolves fine at runtime, but the editor experience degrades and `tsc -noEmit` skips type-checking the test surface entirely. Hashi hit this 3× during phase-1 implementation (commits `09b27bd`, `7734334`, `5402455`) before the include was widened in `4d039f2`. Widening immediately surfaced one real `noUncheckedIndexedAccess` violation that vitest had been masking.
  - **Why:** LSP and `tsc` use `include` to bound their world; vitest uses its own resolver. Without alignment, type errors in tests escape both the IDE and the build.
  - **How to apply:** for any new TS project (Hashi-style or another MiYo TS plugin), the very first `tsconfig.json` should ship with `"include": ["src/**/*.ts", "test/**/*.ts"]` — not retrofitted after the first wave of test files lands. Tests should explicitly import from `vitest` (no globals) so they compose with the same `strict: true` / `noUncheckedIndexedAccess: true` profile as `src/`.
