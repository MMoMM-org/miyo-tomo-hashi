# Troubleshooting

Recover from the most common Hashi failure modes without filing an issue. Each
entry below is written from the symptom you see — find yours, then follow the fix.

## Common errors

### The plugin doesn't appear, or won't enable

**Cause.** Hashi is **desktop-only** (`isDesktopOnly: true`) and requires
**Obsidian ≥ 1.7.2**. On Obsidian Mobile it never appears; on an older desktop
build it shows but refuses to enable.

**Fix.**

- Use desktop Obsidian — Hashi relies on Node APIs (Docker socket, filesystem)
  that don't exist on mobile.
- Update Obsidian to **1.7.2 or newer** (Settings → General → check for updates).
- For a manual install, confirm all three files — `main.js`, `manifest.json`,
  `styles.css` — sit inside `<your-vault>/.obsidian/plugins/miyo-tomo-hashi/`,
  then reload Obsidian. See [Installation](installation.md).

### The Session View stays "Disconnected" or keeps reconnecting

**Cause.** The [Session View](session-view.md) attaches to a [Tomo](https://github.com/MMoMM-org/miyo-tomo)
Docker container over the Docker socket. If your Docker runtime isn't running,
no container has been chosen, or the container is down, the header indicator reads
`Disconnected — <reason>` or cycles `Reconnecting (attempt N)…`. When the daemon
itself can't be reached the reason is `Docker isn't reachable — is Docker running?`;
a socket the plugin can't open reads `Permission denied on the Docker socket …`.
Both are terminal — Hashi stops the reconnect backoff immediately rather than
retrying, since neither resolves by waiting.

**Fix.**

- Start your Docker runtime (Docker Desktop or OrbStack).
- Make sure a Tomo container is actually running.
- Pick the instance in the picker modal, then click **Force reconnect** to retry.
- The [instruction executor](instruction-executor.md) does **not** need Docker —
  only the Session View does. If only chat is broken, executor runs are unaffected.

### A hook never runs

**Cause.** In order of likelihood:

1. **Hooks policy is `Disabled`** — the safe default kill switch. Hooks never run
   regardless of what's in the directory.
2. **The file is `.js`, not `.cjs`** — Electron treats `.js` as ESM, so
   `module.exports` yields an empty object and the hook silently does nothing.
3. **The filename or location is wrong** — it must be `before-<action>.cjs` /
   `after-<action>.cjs`, sit in the configured hooks directory (default
   `.tomo-hashi/hooks/`), and use one of the sixteen [action kinds](action-reference.md).

**Fix.** Settings → **Hooks** → switch to *Ask on first use* or *Enabled*; rename
the file to `.cjs`; match the exact `before-`/`after-<action>` naming. See
[Hooks](hooks.md).

### "Validation failed" — an instruction set won't execute

**Cause.** The `_instructions.json` failed schema validation, so none of its
actions run. The modal's validation-failed view (and the run log's *Validation
failures* table) names the rejected file and the error, e.g.
`unexpected discriminant value at /actions/3/action`. Other valid files in a batch
still execute.

**Fix.** Read the JSON-pointer path in the error (`/actions/3/action` → the 4th
action's `action` field), correct that field in the source JSON — it's emitted by
Tomo, so regenerate or fix it there — and re-run. See the
[instruction executor](instruction-executor.md#3-validation-failed-alternative-to-summary).

### Actions show ⊘ (skipped) instead of ✓

**Not an error.** ⊘ has three flavours, all benign:

- **`skipped-already`** — the target state was already in place; idempotency
  working as intended. Re-running is safe.
- **`skipped-dependency`** — a `link_to_moc` referenced a MOC whose `create_moc`
  failed earlier in the same run. Fix the upstream failure and re-run.
- **`skipped-cancelled`** — you clicked Cancel; the in-flight action committed and
  the rest were recorded as cancelled.

Re-triggering a file is safe: [partial-resume](instruction-executor.md#partial-resume)
re-runs only the unapplied actions.

### "match found only in the YAML frontmatter"

An `edit_note_text` whose `match` exists in the note's frontmatter but nowhere in
the body. **This is a real failure, not a near-miss** — `edit_note_text` is a
note-*body* action and the YAML block is frozen to it, so no re-run will ever
succeed.

It used to report success and quietly do nothing, which meant the action was
marked applied and filtered out of every later run while the note stayed wrong.
If you have instruction sets from before that fix, check them: an action in this
situation is sitting at `applied: true` and will never re-run. Set it back to
`false` by hand.

**Fix.** The property needs [`edit_frontmatter`](action-reference.md#edit_frontmatter)
instead. Either re-run the audit so Tomo emits the right kind, or repair the
action in the [Instruction Fixer](instruction-fixer.md).

### "frontmatter '<key>' … is not what the instruction expected"

An `edit_frontmatter` whose `expected` value does not match what the note holds
right now. **The note is untouched** — not merely unchanged in value: the file
is never opened for writing, so it does not even lose its comments the way a
successful write would.

This is the guard doing its job, not a bug. The instruction set was written
against the note as it looked during the audit; someone or something has changed
that property since. Overwriting blindly would discard whichever change is newer,
so Hashi refuses and tells you.

The message names *shapes*, not values (`expected list of 1, found string`) —
the run log carries metadata only, never note content.

**Fix.** Open the [Instruction Fixer](instruction-fixer.md) on the failed action
and press **Read from note** on *Expected current value*: it fills in what the
note actually holds. Check that the action still makes sense against that value,
save, and re-run. If the property has since been deleted entirely, the button
fills in `null`, which is the correct way to say "this property must not exist".

### My note's frontmatter comments disappeared

`edit_frontmatter` writes through Obsidian's own frontmatter API, which
re-serialises the whole block from its parsed form. **YAML comments do not
survive that** — every `#` line in the block is gone after a successful write.

This is not something Hashi chooses. The alternative is editing YAML as text,
which is the corruption vector the kind exists to avoid; there is no third
option that both edits structurally and preserves comments.

Key order, nested maps and untargeted values are all preserved — see
[what a write does to the rest of the block](action-reference.md#edit_frontmatter).
If a note's frontmatter comments matter, keep that note out of the audit's reach.

### "edit_frontmatter only handles markdown notes"

The target is a `.canvas`, `.base` or some other non-markdown file. Obsidian's
frontmatter API is markdown-only, so this is rejected before the vault is
touched rather than failing partway. There is no workaround — those formats have
no frontmatter block to edit.

## Where to look for logs

- **Run log** — `tomo-hashi-run-log_YYYY-MM-DDTHHMM.md`, written to your configured
  **Tomo inbox folder** (the same folder the executor reads `_instructions.json`
  from). It records every action's outcome, hook lines, and validation failures.
  The execution modal's **View errors** button (shown when failures > 0) opens it
  directly. See [Run log](run-log.md).
- **Run log retention** — if Settings → *Run log retention* is set to *Only after
  failed runs*, zero-failure runs delete their log. Switch to *Always keep* while
  you're debugging.
- **Developer console** — `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (macOS)
  → **Console** tab. This surfaces plugin-load errors and uncaught exceptions that
  never reach the run log.

> The run log records **metadata only** — paths, action kinds, outcomes — never
> note content or credentials. Excerpts are safe to share, with one caveat: a hook
> that writes a secret via `ctx.logger` will have that line recorded verbatim.

## Diagnostic steps

Run through this checklist before escalating:

1. Confirm **desktop** Obsidian **≥ 1.7.2**, with Hashi enabled under
   Settings → Community plugins.
2. **Session View not connecting?** Confirm Docker is running and a Tomo container
   exists, then click **Force reconnect**.
3. **Executor problem?** Open the run log in your inbox folder and read the
   *Counts* and *Validation failures* tables.
4. **Hook not firing?** Confirm Hooks policy isn't *Disabled*, the file is `.cjs`,
   and the filename matches `before-`/`after-<action>`.
5. Open the **developer console** and look for errors at plugin load or during the run.
6. Reload Obsidian (`Ctrl/Cmd+R`) to rule out stale plugin state.

## Escalation

File unresolved issues at
**<https://github.com/MMoMM-org/miyo-tomo-hashi/issues>**.

Include enough to reproduce:

- Obsidian version and your OS.
- Which surface is affected — **Session View** (also note your Docker runtime and
  version), the **instruction executor**, or **hooks**.
- The relevant **run log excerpt** (metadata only — scrub any secret a hook may
  have logged).
- Any **developer console** errors.
- Your **Hashi version** (Settings → Community plugins, or `manifest.json`).

Hashi is a solo-maintained project — issues are handled on a best-effort basis;
there is no guaranteed response time.
