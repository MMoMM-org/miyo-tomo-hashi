# Hooks

Hooks let you extend each action with custom Node code — pre-flight checks, post-action notifications, side-effects that are vault-specific. Hashi loads hook files from a configured directory in your vault and runs them with full plugin privilege (same trust model as Templater).

> **Hooks run with full plugin privilege.** A hook has the same access as Hashi itself: vault read/write, Node filesystem and network, shell execution, environment variables. Only enable hooks from sources you trust.

## Policy

Settings → **Hooks** controls when hooks run:

| Policy | Behaviour |
|---|---|
| **Disabled** *(safe default — kill switch)* | Hooks never run, regardless of what's in the directory. |
| **Ask on first use** | The first time a hook file is encountered in a session, a disclosure modal appears. You choose Enable / Enable once / Disable. The decision is remembered for the rest of the Obsidian session. |
| **Enabled** | Hooks run without per-invocation prompts. |

`Disabled` is the recommended starting point; flip to `Ask` once you have hooks you actually want to run.

> Screenshot — hook disclosure modal: hook filename, vault-relative path, file size, full-privilege warning, three buttons (Disable / Enable once / Enable).
<p align="center">
  <img src="../assets/hook-disclosure.png" alt="Hook disclosure modal — filename, path, size, capability disclosure, three decision buttons (Disable focused as safe default)" width="560" />
</p>

The modal's **Disable** button is the auto-focused primary action so a reflexive Enter or Space cancels rather than enables an untrusted hook for the whole session. Esc resolves to Disable.

## Naming convention

Place `.cjs` files in the configured **Hooks directory** (default: `.tomo-hashi/hooks/`). The filename selects when the hook fires:

- `before-<action>.cjs` — runs *before* the action's handler. A non-empty `errors` return short-circuits the handler and the action is recorded as `failed`.
- `after-<action>.cjs` — runs *after* the action's handler succeeds. Errors here do not retroactively fail the action; they are recorded as a separate log entry.

`<action>` is one of the [action kinds](action-reference.md): `create_moc`, `move_note`, `link_to_moc`, `insert_under_marker`, `replace_section`, `add_relationship`, `update_tracker`, `update_log_entry`, `update_log_link`, `delete_source`, `skip`.

Examples:

```
.tomo-hashi/hooks/
├── before-create_moc.cjs
├── after-move_note.cjs
└── after-delete_source.cjs
```

Multiple hooks for the same kind: only one file per `before-<kind>` / `after-<kind>` is loaded. If you need a chain, compose inside a single file.

## Hook function signature

Each hook file exports a single async function:

```js
// .tomo-hashi/hooks/before-create_moc.cjs
module.exports = async (ctx) => {
  // ctx.action  — the Action variant being executed (immutable);
  //               check ctx.action.action for the kind, then access
  //               kind-specific fields (ctx.action.destination, etc.)
  // ctx.app     — Obsidian's App instance. Read access is broad
  //               (vault, metadataCache, workspace, vault.adapter),
  //               so handle it with the same care as in-process plugin code.
  // ctx.logger  — { info, warn, error } — each takes a string and writes
  //               into the run log. Prefer these over console for
  //               messages the user should see in the run-log UI.

  if (ctx.action.action === "create_moc") {
    ctx.logger.info(`will create MOC at ${ctx.action.destination}`);
  }

  return { info: ["pre-flight ok"] };
};
```

### Return shape

```ts
{
  info?: string[];      // recorded in the run log as informational lines
  warnings?: string[];  // recorded as warnings, do not fail the action
  errors?: string[];    // before-* hooks: short-circuit, action recorded as failed
                        // after-*  hooks: recorded as a separate log entry
}
```

`return undefined` (no return / `return;`) is equivalent to `return {}` — no log entries, no effect on the action.

### Stability of the `ctx` shape

The `ctx` shape is the **stable v0.1 hook API**. Future Hashi versions will only *add* fields (additive, non-breaking). Removing or renaming an existing `ctx` field would be a breaking change and ride a major version bump.

## Why CommonJS (`.cjs`)?

Hashi loads hooks via Node's `createRequire` against the bundled `main.js` file path. CommonJS is what `require()` consumes; ESM (`.mjs`) would need an async import path with different cache semantics. Sticking to `.cjs` keeps the loader synchronous and the cache eviction simple.

If you prefer ESM authoring style, use a CJS wrapper:

```js
// before-create_moc.cjs
module.exports = async (ctx) => {
  const { default: hook } = await import("./before-create_moc-impl.mjs");
  return hook(ctx);
};
```

## Caching and live reload

Hashi evicts the **entry-point file** (`before-<kind>.cjs` / `after-<kind>.cjs`) from `require.cache` on every run, so edits to the hook are picked up without a plugin reload.

> **Authoring caveat — module-level state in helpers.** Helpers transitively imported from your hook (e.g., `_helper.cjs`, `node:crypto`) stay cached for the session. Module-level mutable state in those helpers (counters, open file handles, accumulated buffers) survives between runs and is shared across hook invocations. Keep helpers pure or scope state inside the exported function.

If a helper *must* hold state (e.g., a DB connection), document it clearly and reset it in your hook's entry-point function.

## Disclosure modal lifecycle

When **Hooks policy = Ask** and a hook is encountered for the first time:

1. The modal opens with the hook's vault-relative path + file size in bytes.
2. The user sees a one-paragraph capability disclosure (vault, FS, network, shell, env).
3. The three buttons are ordered safe-first: **Disable** (focused), **Enable once**, **Enable**.
4. The modal's title and the buttons are linked via `aria-labelledby` / `aria-describedby` so screen-reader users hear the warning before the action label.

| Button | Effect |
|---|---|
| **Disable** | This hook will not run for the remainder of the session. Other hooks are unaffected. |
| **Enable once** | This hook runs for *this* invocation only. The next time it's encountered, the modal opens again. |
| **Enable** | This hook runs for the remainder of the session without prompting. |

Esc, click outside the modal, or click the X chrome → resolves to **Disable**. The modal cannot be dismissed without a decision.

## Run-log integration

Hooks emit lines into the run log via `ctx.logger`. The log records:

- File path of the hook
- Decision made by the disclosure modal (when ask-mode)
- Each line returned in `info` / `warnings` / `errors`
- Total elapsed time inside the hook

A hook timeout (default 30 s, hard-coded in v0.1) records a `failed` outcome with the reason `hook-timeout`. The action's outcome follows the same `before-` short-circuit / `after-` separate-log rules.

## Working examples

### Rewrite aliases after move

When Tomo renders a note, it sets the note name to an auto-generated value (e.g. `2026-05-26_1918_Asahikawa Hokkaido's second-largest city`). This hook replaces the alias with the note's title — not directly useful, but you can substitute it with a translation function for example :-) .

The same pattern works for both `after-move_note.cjs` and `after-create_moc.cjs` — both action types carry `ctx.action.destination` (the final vault path) and `ctx.action.title`.

```js
// .tomo-hashi/hooks/after-move_note.cjs
//
// Rewrites the aliases array in frontmatter after Hashi moves the note.
// ctx.action fields used:
//   - destination  (string) — vault-relative path of the moved note
//   - title        (string) — final note title
//
// Obsidian API used:
//   - app.vault.getAbstractFileByPath(path) — resolve TFile from path
//   - app.fileManager.processFrontMatter(file, fn) — atomic read-mutate-write
//     of YAML frontmatter. The callback receives a mutable object; changes
//     are serialised back to the file automatically.
//
// Return shape:
//   { info: string[] }   — logged to the Hashi run log
//   { errors: string[] } — recorded as hook failure (action still applied)
//
module.exports = async (ctx) => {
  const { action, app, logger } = ctx;

  // getAbstractFileByPath returns TFile | TFolder | null.
  // For a .md destination this will always be a TFile.
  const file = app.vault.getAbstractFileByPath(action.destination);
  if (!file) {
    return { warnings: [`File not found at ${action.destination}`] };
  }

  try {
    await app.fileManager.processFrontMatter(file, (fm) => {
      // fm is a mutable JS object representing the YAML frontmatter.
      // Assigning a property writes it back; deleting removes the key.
      fm.aliases = [`${action.title} (HASHI)`];
    });
  } catch (err) {
    return { errors: [`processFrontMatter failed: ${err}`] };
  }

  logger.info(`alias → "${action.title} (HASHI)"`);
  return { info: [`alias → "${action.title} (HASHI)"`] };
};
```

> **Tip — `create_moc` variant.** Copy the file as `after-create_moc.cjs`. The code is identical — both `move_note` and `create_moc` actions expose `destination` and `title`.

### Post-move backlink audit (read-only)

A minimal hook that logs information without modifying any files. Useful for debugging or vault analytics.

```js
// .tomo-hashi/hooks/after-move_note.cjs
//
// Read-only audit: count outgoing links in the moved note.
// Uses metadataCache — fast, no disk reads, no vault writes.
//
module.exports = async (ctx) => {
  const file = ctx.app.vault.getAbstractFileByPath(ctx.action.destination);
  if (!file) {
    return { warnings: [`moved file not found at ${ctx.action.destination}`] };
  }

  const cache = ctx.app.metadataCache.getFileCache(file);
  const linkCount = (cache?.links ?? []).length;
  return {
    info: [`moved → ${ctx.action.destination}; outgoing links: ${linkCount}`],
  };
};
```

### Pre-flight guard: block moves to protected folders

A `before-` hook that rejects actions matching a condition. The `errors` return short-circuits the handler — the action is recorded as `failed` and never executes.

```js
// .tomo-hashi/hooks/before-move_note.cjs
//
// Reject moves into folders the user wants to protect from automation.
//
const PROTECTED = ["Atlas/000 Archive", "Atlas/999 Restricted"];

module.exports = async (ctx) => {
  const dest = ctx.action.destination;
  for (const prefix of PROTECTED) {
    if (dest.startsWith(prefix)) {
      return { errors: [`Blocked: ${dest} is in a protected folder`] };
    }
  }
  // undefined return = no effect, handler proceeds normally
};
```

## See also

- [Action reference](action-reference.md) — what each `ctx.action.action` value carries
- [Run log](run-log.md) — where hook output ends up
- [Configuration / Hooks policy](configuration.md#b--instruction-executor) — settings reference
