# Pre-Release Findings — 2026-05-27

Audit of open Dependabot alerts and deferred spec-review items.

## Dependabot Alerts (6 open)

### HIGH — fast-uri (2 alerts)

| Alert | CVE | Fixed in |
|-------|-----|----------|
| [#5](https://github.com/MMoMM-org/miyo-tomo-hashi/security/dependabot/5) — path traversal via percent-encoded dot segments | CVE-2026-6321 | 3.1.1 |
| [#6](https://github.com/MMoMM-org/miyo-tomo-hashi/security/dependabot/6) — host confusion via percent-encoded authority delimiters | CVE-2026-6322 | 3.1.2 |

**Dependency chain:** `ajv@8.20.0` → `fast-uri@3.1.0`

Hashi uses ajv for instruction-set schema validation (`src/schema/validator.ts`) against a vendored JSON schema. The schema has no URI-shaped fields, so exploitation is theoretical — ajv never parses user-supplied URIs through fast-uri. Still, `npm update ajv` should pull a patched fast-uri and close both alerts.

### MEDIUM — protobufjs

| Alert | CVE | Fixed in |
|-------|-----|----------|
| [#10](https://github.com/MMoMM-org/miyo-tomo-hashi/security/dependabot/10) — DoS via unbounded recursive JSON descriptor expansion | CVE-2026-45740 | 7.5.8 |

**Dependency chain:** `dockerode@4.0.12` → `@grpc/grpc-js` → `@grpc/proto-loader` → `protobufjs@7.5.6`

Hashi uses dockerode's Unix-socket HTTP transport exclusively — the `@grpc/*` subtree is pulled transitively but never invoked. Blocked on dockerode bumping its grpc dependencies.

### MEDIUM — uuid

| Alert | CVE | Fixed in |
|-------|-----|----------|
| [#8](https://github.com/MMoMM-org/miyo-tomo-hashi/security/dependabot/8) — missing buffer bounds check in v3/v5/v6 when `buf` is provided | CVE-2026-41907 | 11.1.1 |

**Dependency chain:** `dockerode@4.0.12` → `uuid@10.0.0`

Major-version gap (10→11). Needs dockerode to update. Not exploitable through Hashi — dockerode calls uuid internally without user-supplied `buf` arguments.

### MEDIUM — ws (dev only)

| Alert | CVE | Fixed in |
|-------|-----|----------|
| [#9](https://github.com/MMoMM-org/miyo-tomo-hashi/security/dependabot/9) — uninitialized memory disclosure | CVE-2026-45736 | 8.20.1 |

**Dependency chain:** `jsdom@26.1.0` → `ws@8.20.0`

Dev dependency only — jsdom is the test runtime. Never in the production bundle. `npm update jsdom` would fix.

### MEDIUM — brace-expansion (dev only)

| Alert | CVE | Fixed in |
|-------|-----|----------|
| [#7](https://github.com/MMoMM-org/miyo-tomo-hashi/security/dependabot/7) — large numeric range defeats documented `max` DoS protection | CVE-2026-45149 | 5.0.6 |

**Dependency chain:** `eslint-plugin-obsidianmd` → `eslint-plugin-import` → `minimatch` → `brace-expansion@2.1.0`

Dev dependency only — deep transitive under lint tooling. Never in the production bundle. Blocked on upstream.

### Summary

| Action | Alerts closed |
|--------|---------------|
| `npm update ajv` | #5, #6 (both HIGH) |
| Wait for dockerode bump | #10, #8 |
| `npm update jsdom` (optional, dev-only) | #9 |
| Upstream eslint-plugin-obsidianmd (parked) | #7 |

---

## Deferred Spec Items

From the 2026-04-25 multi-batch review on `feat/xdd-scaffold`. All classified **Defer** — out of scope for the XDD-scaffold branch. Source: `docs/ai/memory/context.md`.

### Implementation-time

Resolve during the relevant implementation phase.

#### M20 — NFR measurement methods

Latency budgets are declared ("plugin load → chat view ≤ 500 ms p95", "discovery p95 ≤ 300 ms", "schema validation ≤ 200 ms / 100 actions") with no measurement method. Currently unenforceable.

- **Location:** `docs/XDD/specs/001-session-view/solution.md` Quality Requirements / Performance; `docs/XDD/specs/002-instruction-executor/solution.md` Quality Requirements
- **Decision needed:** drop budgets as informational, or pin a measurement (`performance.now()` in live tests, median of 20 runs, threshold = 2× target for jsdom flake tolerance)

#### M23 — F4 partial-failure tests

When a vault write fails after a partial side effect (e.g., destination folder created, then `fileManager.renameFile` throws), the leaked folder is undocumented.

- **Location:** `docs/XDD/specs/002-instruction-executor/plan/phase-3.md` handler tasks
- **Action:** add unit tests in T3.2 / T3.3 pinning actual behaviour ("leaked folder, no cleanup in v0.1"); document in PRD F4 Edge Cases

#### M24 — Test seam strategy section

Each plan README should list the seams (dockerode via `vi.mock`, Vault via FakeVaultFS, time via `vi.useFakeTimers`, hook loader via fixtures, schema validator scripted) and mandate explicit timer/event-loop control for async-ordering tests.

- **Location:** both `plan/README.md` files
- **Action:** add a "Test seam strategy" section

#### M25 — 50-file batch perf bound

PRD-002 edge case mentions 50-file batch with no upper bound or perf test. Allows silent runaway.

- **Location:** `docs/XDD/specs/002-instruction-executor/requirements.md` F1/F2 Constraints; plan/phase-2 or phase-6
- **Decision needed:** (a) hard upper bound + Notice-on-exceed, (b) perf test in live tests with 30 s end-to-end budget, or (c) lazy/streaming validation

#### M26 — Docker engine API floor

Spec 001 SDD references "Docker Engine API v1.45" without stating it as a minimum or tested floor. OrbStack / colima / Podman compatibility unstated.

- **Location:** `docs/XDD/specs/001-session-view/solution.md` Constraints / Deployment View
- **Action:** add minimum API version (e.g. 1.41+ which dockerode broadly targets), tested host runtimes (Docker Desktop, OrbStack), explicit Podman non-support in v0.1

#### M27 — OS-tier runtime guard

Charter says macOS primary, Linux theoretical, Windows user-contribution. Manifest has `isDesktopOnly` but no per-OS gating.

- **Location:** `docs/XDD/specs/001-session-view/solution.md` or `src/main.ts`
- **Decision needed:** add a load-time OS detection with one-time Notice ("Linux: experimental, Windows: user-contributed"), or document explicitly that no per-OS gating exists in v0.1

#### H25 — prefers-reduced-motion test mocks

PRD-001 F3/F5 ARIA + reduced-motion ACs have no test plan; jsdom doesn't honor `prefers-reduced-motion`.

- **Location:** `docs/XDD/specs/001-session-view/plan/phase-4.md` T4.2 / T4.3
- **Decision needed:** (a) mock `window.matchMedia('(prefers-reduced-motion: reduce)')` in unit tests, or (b) move AC to manual-QA in T5.5b

### Cosmetic / nice-to-have

#### L1 — 001 PRD palette command annotation

001 README scope lists "Execute instructions document" as a 002-owned palette command alongside 001's two — inflates the "three commands for 001" headline.

- **Location:** `docs/XDD/specs/001-session-view/README.md` Scope section
- **Action:** move palette inventory into shared `docs/XDD/README.md` table when convenient

#### L3 — F6 MoSCoW totals visibility

002 PRD claims "11 Must, 0 Should, 0 Could" without surfacing the asymmetry vs spec 001 (9 Must + 2 Should).

- **Location:** `docs/XDD/README.md` spec table
- **Action:** add MoSCoW totals so the difference is visible without opening either PRD

#### L11 — Test data isolation

002 plan T6.3 has 8 live-test scenarios but doesn't say whether they share or isolate tmpdirs.

- **Location:** `docs/XDD/specs/002-instruction-executor/plan/phase-6.md` T6.4
- **Action:** add explicit "fresh test vault per scenario" note to manual-QA tasks

#### L12 — Manual vs automated UI assertion split

Phase-4 (001) and Phase-5 (002) UI tests don't split "[jsdom]" from "[manual]" per assertion.

- **Location:** `docs/XDD/specs/001-session-view/plan/phase-4.md`; `docs/XDD/specs/002-instruction-executor/plan/phase-5.md`
- **Action:** tag each UI test row so coverage is unambiguous

### Architectural / process

#### M12 — Hierarchical CLAUDE.md cull

Three of four hierarchical CLAUDE.md files (`docs/ai/CLAUDE.md`, `test/CLAUDE.md`, `src/CLAUDE.md`) restate global rules from `~/Kouzou/standards/`.

- **Decision needed:** delete them once implementation reveals what scoped guidance the implementer actually needs, or keep as navigational anchors

### Closed

**M3 — Explicit AC IDs in PRD** — push-back applied. Promoting `[ref: PRD/F1/AC5]` to anchored `**AC F1.1**` IDs across ~150 ACs rejected as cost-disproportionate. The H5 recount-and-lock-the-count approach (Output Schema row holds canonical total; CI gate fails on mismatch) addresses the same failure mode. No further action.
