# MiYo Hashi

Direct integration with Tomo (Claude Code) sessions for session interaction and automated vault updates

@~/Kouzou/standards/general.md

## Project Files
@~/Kouzou/projects/miyo/team.md

## Memory & Context
@docs/ai/memory/memory.md

## Routing Rules
- Repo conventions/style → docs/ai/memory/general.md
- Tool/CI/build knowledge → docs/ai/memory/tools.md
- Domain/business rules → docs/ai/memory/domain.md
- Architectural decisions → docs/ai/memory/decisions.md
- Current focus/blockers → docs/ai/memory/context.md
- Bugs/fixes → docs/ai/memory/troubleshooting.md

## Build Commands
```bash
npm run build        # TypeScript check + esbuild production build
npm test             # vitest unit tests
npm run lint         # eslint with obsidianmd rules
npm run dev          # esbuild watch mode (development)
npm run test:watch   # vitest watch mode
npm run test:coverage # vitest with v8 coverage
```

## Test Vault — `test/Hashi/`
Local manual-QA vault (gitignored). See `test/Hashi/SETUP.md` for full guide.
```bash
HASHI_DEPLOY_VAULT=1 npm run build   # build + deploy plugin into test/Hashi/.obsidian/plugins/miyo-tomo-hashi
bash test/Hashi/reset-vault.sh       # restore vault content from Archive.zip (preserves .obsidian/)
```

## Rules
- Use Plan Mode for any change touching more than 2 files
- Commit after every completed task
- When changes affect other repos → create handoff in _outbox/
