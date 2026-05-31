# Development Guide

## Setup

```bash
git clone https://github.com/MMoMM-org/miyo-tomo-hashi.git
cd miyo-tomo-hashi
git config core.hooksPath .githooks   # commit hooks (block-main, conventional commits)
npm install
```

`npm install` (or `npm ci` for lockfile-pinned installs) gets you a working dev environment.

## Build

```bash
npm run build        # tsc check + esbuild production bundle (main.js + styles.css at repo root)
npm run dev          # esbuild watch mode for development
```

Obsidian expects `main.js` at the plugin root — NOT `dist/`. The esbuild config handles this.

## Test

```bash
npm test             # vitest unit tests
npm run test:watch   # vitest watch mode
npm run test:coverage # vitest with v8 coverage
npm run test:live    # live integration tests (requires Docker + a Tomo container running)
```

The default `vitest run` covers ~800 unit tests across 56 files. Live tests are excluded from the default config and run only via `test:live`.

## Lint

```bash
npm run lint         # eslint (src/ + manifest.json) AND stylelint (styles.css)
npm run lint:css     # stylelint styles.css only
```

ESLint's Obsidian-specific rules check for forbidden DOM patterns, raw `fs` writes to vault paths, and the patterns enumerated in our internal audit (see [the registerDomEvent hardening PR](https://github.com/MMoMM-org/miyo-tomo-hashi/pull/1) for an example).

`npm run lint` also runs **stylelint** with `stylelint-no-unsupported-browser-features`, which mirrors the Obsidian community-plugin bot's CSS check: it reports any CSS feature only *partially* supported by Obsidian's Chromium (pinned via the `browserslist` floor `chrome 124`, the engine in Obsidian 1.6.5 / Electron 30). This is what catches `text-decoration` with a style value (`solid`/`wavy`) — the bot flags it even though ESLint never lints CSS. Prefer `border-bottom` for underline-style state cues (see `styles.css`).

## Test vault

The `test/Hashi/` directory is a local manual-QA Obsidian vault (gitignored). See [`test/Hashi/SETUP.md`](../test/Hashi/SETUP.md) for the full guide.

```bash
HASHI_DEPLOY_VAULT=1 npm run build   # build + deploy plugin into test/Hashi/.obsidian/plugins/miyo-tomo-hashi
bash test/Hashi/reset-vault.sh       # restore vault content from Archive.zip (preserves .obsidian/)
```

The deploy build copies `main.js`, `manifest.json`, and `styles.css` into the test vault's plugin folder, with the manifest version stamped to `0.1.0-dev.YYYYMMDD-HHMM` so you can tell which build is loaded.

After the manual-QA pass, walk the checklist at `docs/XDD/specs/002-instruction-executor/plan/manual-qa-checklist.md`.

## Architecture

See [How It Works](how-it-works.md) for the runtime architecture — the two-component split, the layer boundaries, and what each module owns.

| Layer | Module | Notes |
|---|---|---|
| Plugin entry | `src/main.ts` | Registers everything; double-onload-guarded |
| Connection | `src/connection/` | Docker dial, attach stream, reconnect loop |
| Chat UI | `src/ui/chat-view/`, `src/ui/status-bar/` | xterm host, status-bar 友 |
| Schema | `src/schema/` | Vendored Tomo schema + ajv validator |
| Executor | `src/executor/` | RunState store, planner, per-action handler |
| Actions | `src/actions/` | One handler per action kind |
| Hooks | `src/hooks/` | Loader, runner, disclosure modal |
| Vault adapter | `src/vault/` | `ObsidianVaultFS` (production), `FakeVaultFS` (tests) |
| Executor UI | `src/ui/ExecutionModal.ts`, `src/ui/modalContent/`, `src/ui/statusBar.ts` | Preview / progress / summary; status-bar 橋 |

## Spec-driven development

Hashi follows the XDD pattern: **PRD → SDD → Plan → Implement → Validate**. Each spec lives under `docs/XDD/specs/NNN-<slug>/`:

- `requirements.md` (PRD) — product requirements + acceptance criteria
- `solution.md` (SDD) — solution-level design + ADRs
- `plan/README.md` — phase index
- `plan/phase-N.md` — per-phase tasks + status

Active specs at the time of writing:

- **001-session-view** — Tomo Docker session GUI (closed)
- **002-instruction-executor** — `_instructions.json` runner + hooks (closed)

Future work either extends an existing spec (decision logged in its README) or scaffolds a new spec via `/xdd`.

## Committing

- Conventional commits — `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`. Release notes are generated from commit history.
- `main` is protected at the git-hook level (`block-main-edits.sh` PreToolUse hook + `.githooks/pre-commit`). Any non-trivial change uses a feature branch.
- Single-session escape if you genuinely need to edit `main`: relaunch Claude with `CLAUDE_ALLOW_MAIN_EDITS=1`.

## Pull requests

1. Open an issue first for anything non-trivial so we can align on scope.
2. Branch from `main` with a descriptive name (e.g., `fix/path-traversal`, `feat/granular-hook-policy`).
3. Keep changes focused — one feature or one fix per PR.
4. `npm run build`, `npm test`, and `npm run lint` must pass before pushing.
5. PR description should reference the spec ID and any acceptance criteria touched.

For security issues, do **not** open a public issue — email marcus@mmomm.org instead.

## Contributing patterns

- Avoid raw `fs` writes that target vault paths — go through `ObsidianVaultFS` (`src/vault/ObsidianVaultFS.ts`). Raw `fs` is allowed *only* in `src/hooks/FsHookLoader.ts` (read-only hook discovery) and `src/util/paths.ts` (realpath containment check). Both are documented and tested.
- DOM event listeners on long-lived elements (`document`, `window`, status-bar items) → use `plugin.registerDomEvent`. See the [registerDomEvent hardening PR](https://github.com/MMoMM-org/miyo-tomo-hashi/pull/1) for the rationale and exceptions (Modal subclasses, repeated-onOpen views).
- New actions → add a handler in `src/actions/<name>.ts`, register in `src/actions/index.ts` HANDLERS map, add the discriminant to the schema (`src/schema/instructions.schema.json`), write tests in `test/unit/actions/<name>.test.ts` covering happy + denial path.
- New settings → extend `PluginSettings` (`src/types/index.ts`), add to `DEFAULT_SETTINGS`, surface in `SettingsTab.ts`, write a path-safety unit test if it's a path field.

## License

[MIT](../LICENSE)
