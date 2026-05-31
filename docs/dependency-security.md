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
`uuid@11.1.1` keeps the API identical (`.v4`) while clearing the warning.

## Reproduce

```bash
npm install                       # applies package.json "overrides"
npm run build                     # produces build/main.js
npm audit --omit=dev              # → found 0 vulnerabilities
grep -c "protobufjs" build/main.js  # → 0 (grpc/protobuf severed by the buildkit stub)
```

---

*Last reviewed: 2026-05-31 — fast-uri / protobufjs / uuid advisories from the
Obsidian community-plugin bot; resolved via pinned `overrides` after
bundle-level reachability verification.*
