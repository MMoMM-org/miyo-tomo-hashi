# Hashi — Agent Guide

## Repo Layout

```
src/
  main.ts              Plugin entry point (extends Obsidian Plugin)
  types/               Shared TypeScript types
  settings/            Settings UI (PluginSettingTab)
test/
  __mocks__/obsidian.ts  Obsidian API mock for unit tests
```

## Commands

```bash
npm run build        # TypeScript check + esbuild
npm test             # vitest
npm run lint         # eslint with obsidianmd rules
```

## Architecture

- Plugin extends `obsidian.Plugin`
- Settings extend `obsidian.PluginSettingTab`
- All Obsidian API usage goes through typed imports from `obsidian`
- Tests use vitest with a mock of the Obsidian API
