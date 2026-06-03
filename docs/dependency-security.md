# Dependency Security — MiYo Tomo Hashi

> Constitution L2 Dependencies: document why each external dependency is needed
> and verify that advisory warnings do not affect the shipped plugin. This file
> answers the Obsidian community-plugin bot's dependency warnings for reviewers.

## Summary

The Obsidian submission bot flagged four advisories across three **runtime**
dependencies (devDependencies such as `semantic-release`, `npm`, and the
`eslint-*` toolchain never ship in `main.js` and are out of scope). Each was
verified against the **actual bundled `build/main.js`** and resolved with a
pinned `overrides` entry in `package.json`:

| Advisory | Dependency | Reaches via | In shipped bundle? | Reachable code path? | Resolution |
|---|---|---|---|---|---|
| [GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6), [GHSA-v39h-62p7-jpjc](https://github.com/advisories/GHSA-v39h-62p7-jpjc) — fast-uri path traversal | `fast-uri` | `ajv` (schema validation) | Yes | **No** — schemas are first-party & static | Override → `fast-uri@3.1.2` |
| [GHSA-jggg-4jg4-v7c6](https://github.com/advisories/GHSA-jggg-4jg4-v7c6) — protobufjs DoS | `protobufjs` | `dockerode` → grpc → `./buildkit` | **No** — `./buildkit` is stubbed at build time | n/a (absent) | Override → `protobufjs@7.6.2` (defensive) |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — uuid buffer bounds | `uuid` | `dockerode` (`session.js`) | Yes | **No** — advisory affects `v3/v5/v6` *with `buf`*; dockerode calls only `v4()` (no `buf`) | Override → `uuid@11.1.1` |

After the overrides, `npm audit --omit=dev` reports **0 vulnerabilities**.

## Reachability detail

### `protobufjs` — not in the bundle

`dockerode` pulls `@grpc/grpc-js` → `@grpc/proto-loader` → `protobufjs`, but only
through `Docker.prototype.followProgress`, which lazy-`require`s `./buildkit`
(the image-build progress streamer). Hashi never builds images — it only
lists/inspects/attaches/resizes containers — so `esbuild.config.mjs` stubs
`./buildkit` at build time (see the `stub-missing-native-deps` plugin). The grpc
and protobuf graph is therefore severed:

```
$ grep -c "protobufjs" build/main.js
0
```

The `protobufjs@7.6.2` override is purely cosmetic (keeps `npm audit` clean); the
vulnerable code is not shipped.

### `fast-uri` — shipped, but not reached with untrusted input

`ajv` uses `fast-uri` to resolve `$ref` URIs in JSON schemas. Hashi compiles only
its own static, first-party instruction-set schemas (`src/schema/`); the data it
validates is parsed as JSON values, never as URIs. The advisory's path-traversal
parser is never fed attacker-controlled input. The override to `fast-uri@3.1.2`
removes the vulnerable parser regardless, as defense-in-depth.

### `uuid` — shipped and called, but not the vulnerable API

`dockerode`'s `lib/session.js` calls `require("uuid").v4` with **no `buf`
argument**. The advisory only affects `v3`/`v5`/`v6` when a caller-supplied `buf`
is provided — `v4()` with no buffer is unaffected. (Hashi does not use Docker
sessions at all, so even this call is not exercised in practice.) The override to
`uuid@11.1.1` keeps the API identical (`.v4`) — and per the advisory, `11.1.1`
**is the patched release** for the 11.x line (`< 11.1.1` is affected, `11.1.1`
is fixed), so `npm audit --omit=dev` reports it clean.

> **Note for automated scanners.** A scanner that does not resolve npm
> `overrides` (the Obsidian community-plugin bot among them) reads
> `dockerode`'s *declared* range `uuid@^10.0.0` and may keep reporting this
> advisory even though the installed and shipped version is `11.1.1`. This is
> a false positive: the resolved dependency is the patched `11.1.1`, **and**
> the vulnerable `v3/v5/v6`-with-`buf` API is never called regardless of
> version. `npm ls uuid` confirms the only resolved version is `11.1.1`.

## Reproduce

```bash
npm install                       # applies package.json "overrides"
npm run build                     # produces build/main.js
npm audit --omit=dev              # → found 0 vulnerabilities
npm ls uuid                       # → uuid@11.1.1 overridden (the patched release)
grep -c "protobufjs" build/main.js  # → 0 (grpc/protobuf severed by the buildkit stub)
```

## Development-only advisories (never shipped)

These advisories sit entirely in **devDependencies** — test runner, release
tooling. None of them is in `build/main.js` (`npm audit --omit=dev` reports
**0 vulnerabilities**), so they cannot affect an installed plugin. They are
recorded here for the Dependabot/Obsidian-bot audit trail.

| Advisory | Dependency | Reaches via | Resolution |
|---|---|---|---|
| [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp) / CVE-2026-47429 — **critical**, Vitest UI server arbitrary file read/execute | `vitest` (`< 4.1.0`) | direct devDependency (test runner) | **Bumped `vitest` → `^4.1.8`** |
| [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) — moderate, `ws` uninitialized memory disclosure | `ws` | transitive under the vitest/jsdom test tree | Cleared via `npm audit fix` |
| [GHSA-jxxr-4gwj-5jf2](https://github.com/advisories/GHSA-jxxr-4gwj-5jf2) — moderate, `brace-expansion` DoS | `brace-expansion@5.0.5` | `@semantic-release/npm` → **vendored `npm` CLI** (`node_modules/npm/node_modules/…`) | **Accepted** — see below |

### `vitest` — critical, but the vulnerable path was never reachable

The advisory only triggers "when the Vitest UI server is listening". Hashi has
**no `@vitest/ui` dependency** and no script runs `vitest --ui` (tests run as
`vitest run`, which starts no server), so the vulnerable code was never
installed or executed. The bump to `vitest@^4.1.8` removes the package version
entirely and keeps Dependabot green; the v3→v4 upgrade required only a small
test-typing migration (`ReturnType<typeof vi.fn>` → `Mock<…>` where a mock is
assigned to a concrete signature). All 1134 tests pass on v4.

### `brace-expansion` — bundled inside the npm CLI, accepted

The remaining moderate advisory is **not** in Hashi's own dependency graph: it
lives in the full `npm` CLI that `@semantic-release/npm` vendors under
`node_modules/npm/node_modules/brace-expansion`. It cannot be fixed with a
top-level `overrides` entry (the vendored copy is isolated) and is never
reachable from the plugin — `npm` runs only inside the CI release job, against
first-party arguments, and ships nothing. Bumping it would mean replacing the
`@semantic-release/npm` wrapper, which is out of proportion to a moderate DoS in
a release-only tool. Accepted and tracked here.

## Reproduce (dev advisories)

```bash
npm audit --omit=dev   # → 0 vulnerabilities (nothing reaches the bundle)
npm ls vitest          # → vitest@4.1.8
npm ls brace-expansion # → only the vendored npm@… copy remains (release-only)
```

---

*Last reviewed: 2026-06-03 — added development-only advisory section: vitest
critical (GHSA-5xrq-8626-4rwp) bumped to 4.1.8, ws cleared, brace-expansion in
the vendored npm CLI accepted. Earlier: fast-uri / protobufjs / uuid runtime
advisories resolved via pinned `overrides` after bundle-level reachability
verification.*
