---
title: "Manual QA Checklist — spec 001-session-view"
spec: 001-session-view
status: pending
generated: 2026-04-28
---

# Manual QA Checklist

> **Gate**: every row must be marked `Y` (passed) before T5.9 release-gate can declare release-readiness. Rows that fail (`N`) trigger a follow-up TDD task per the deviation protocol in `plan/README.md`. The release gate (T5.9) reads this file's frontmatter `status:` field — flip to `passed` only when all rows are `Y` (or `Y` with documented deferred follow-up).

## Why this exists

Hashi's unit suite covers state-machine logic, DOM structure, and the dockerode wire surface (via `vi.mock('dockerode')` and `test/__mocks__/obsidian.ts`). The live suite (`test/live/*.live.test.ts`) extends that to a real Docker daemon. Neither tier can cover:

- **Visual rendering** — the 友 kanji glyph in the status bar, color-vs-shape state distinction, banner persistence, warning-icon presence on fallback rows
- **Real-Obsidian DOM behavior** — focus trap inside `Modal`, keyboard navigation, scroll behavior in the picker with many candidates, last-known-leaf-location persistence across restart
- **OS-level accessibility** — `prefers-reduced-motion: reduce` respect, VoiceOver / screen-reader announcements via `aria-live` regions
- **xterm.js renderer trust boundary** — OSC 8 hyperlink suppression, OSC 52 clipboard suppression (need crafted output to verify the live behavior)
- **Closed-loop end-to-end chat flow inside an actual `WorkspaceLeaf`** — the live suite verifies up to `TomoConnection`; this checklist closes the chain through `TomoChatView` to the rendered terminal

This file is the authoritative gate for those concerns. Coverage mapping to PRD ACs lives in `plan/traceability.md` — every `M:row Fx.y` reference there must resolve to a row here.

## Deployment

Build the plugin into the in-repo test vault:

```bash
HASHI_DEPLOY_VAULT=1 npm run build
```

This copies `build/main.js`, `manifest.json`, and the bundled `styles.css` into `test/Hashi/.obsidian/plugins/miyo-tomo-hashi/`. The vault's `hot-reload` plugin (committed at `test/Hashi/.obsidian/plugins/hot-reload/`) picks up changes on every rebuild — re-run the build, observe Obsidian reload the plugin without a full app restart.

Default behavior (no env var) is unchanged: build artifacts land in `build/` only. CI builds are unaffected.

Open `test/Hashi/` as a vault in Obsidian. Trust the author. Enable **MiYo Tomo Hashi** in *Settings → Community Plugins*.

## Pre-flight (one-time per QA pass)

Start a Tomo-shaped container locally:

```bash
docker run -d --rm \
  --label miyo.component=tomo \
  --label miyo.tomo.instance-name=qa-test \
  --name hashi-qa-tomo \
  -it alpine:latest sh
```

For multi-Tomo rows, repeat with different `--name` values; for the >20-container row, see the row's notes for a one-line spawn loop.

After QA, clean up:

```bash
docker rm -f hashi-qa-tomo
docker ps --filter label=miyo.component=tomo -q | xargs -r docker rm -f
```

## Checklist rows

Columns: `# | AC ref | What to observe | Expected | Observed | Passed (Y/N) | Notes`. Pre-flight has populated `Expected` for every row; the QA operator fills `Observed`, `Passed`, and any `Notes` during the walkthrough.

### F1 — Settings → Connect with Instance Picker

| # | AC ref | What to observe | Expected | Observed | Passed (Y/N) | Notes |
|---|---|---|---|---|---|---|
| 1 | F1.1 | Open *Settings → MiYo Tomo Hashi → Connect*. Verify the picker lists the running `qa-test` container. | One row per running container with label `miyo.component=tomo`. Each row shows the instance name and an uptime string ("3m", "2h12m", etc.) | | | |
| 2 | F1.2 | Stop all Tomo containers (`docker rm -f $(docker ps -q --filter label=miyo.component=tomo)`). Re-open the picker. | Empty-state copy: "No Tomo instance seems to be running…" rendered as plain text. No spinner, no auto-retry. | | | |
| 3 | F1.3 | Stop the Docker daemon (`sudo launchctl stop com.docker.docker` on macOS, or quit Docker Desktop). Open the picker. | Inline named error "Docker daemon not reachable". Distinct from the empty-state copy. Picker stays open with retry affordance. | | | |
| 4 | F1.4 | **Linux only** — chmod the docker socket to deny read access for the current user. Open the picker. | Inline named error "Docker socket permission denied". Distinct from "daemon not reachable". | | | If on macOS, mark `Y` and note "skipped — Linux-only AC; see live test docker-discovery.live.test.ts" |
| 5 | F1.5 | Start a container missing the `miyo.tomo.instance-name` label (`docker run -d --rm --label miyo.component=tomo alpine sleep 3600`). Open the picker. | Row shows the short container ID (12 chars) prefixed with a warning icon (⚠ or similar). Row is selectable. | | | |
| 6 | F1.8 | Start two containers with the **same** `miyo.tomo.instance-name=qa-test` label. Open the picker. | Both rows visible, disambiguated by a short container ID in parentheses — e.g. `qa-test (abc123def456)`. Selecting either connects without confusion. | | | |
| 7 | F1.9 | Start 25 disposable containers with the label: `for i in $(seq 1 25); do docker run -d --rm --label miyo.component=tomo --label miyo.tomo.instance-name=qa-$i alpine sleep 600; done`. Open the picker. | All 25 rows present. Arrow keys cycle through rows; modal scrolls when content overflows; no row text truncation; rows sorted by `startedAt` descending. | | | |
| 8 | F1.10 | Open the picker with `qa-test` running. While the picker is open, externally `docker rm -f hashi-qa-tomo`. Click the now-stale row. | Named error `attach-failed` ("Tomo instance no longer available — refresh"). Picker stays open and shows the still-running candidates after the refresh. | | | |

### F2 — Settings → Disconnect

| # | AC ref | What to observe | Expected | Observed | Passed (Y/N) | Notes |
|---|---|---|---|---|---|---|
| 9 | F2.1 | Connect to `qa-test`. Click *Disconnect*. In a separate terminal, `docker inspect hashi-qa-tomo --format='{{.State.Running}}'`. | Output: `true`. Container is still running. The Hashi stream is closed but the container itself is untouched. | | | |

### F3 — Status Bar Icon (icon-only with popover)

| # | AC ref | What to observe | Expected | Observed | Passed (Y/N) | Notes |
|---|---|---|---|---|---|---|
| 10 | F3.1 | Look at the right side of the Obsidian status bar with Hashi enabled. Test on macOS Obsidian **stable** AND **Insider** if available. | The 友 kanji glyph renders as the actual character (not a fallback `□` box, not a question-mark). Visible in both light and dark themes. | | | |
| 11 | F3.2 | Cycle through states: connect (green), then `docker restart hashi-qa-tomo` (reconnecting), then disconnect via popover (disconnected). Take screenshots of each state. **Then enable macOS color-blind filter** (System Settings → Accessibility → Display → Color Filters → Greyscale) and re-cycle. | Each state is visually distinct via shape **and** color (e.g., outline vs. filled, dot vs. ring, pulse vs. static) — **never color alone**. Distinguishable in greyscale. | | | |
| 12 | F3.3 | Hover over the icon in each state. Wait for the tooltip. | Tooltip text matches state: "Tomo: qa-test" (connected with named instance), "Tomo: <shortId>" (connected with no name label), "Reconnecting…" (during reconnect), "Connecting…" (during initial attach), "Tomo: disconnected" (after Disconnect). | | | |
| 13 | F3.4 | Click the icon. | Popover (Obsidian `Menu`) opens with **exactly three** items: "Force reconnect", "Open chat window", "Go to settings" — in that order. | | | |
| 14 | F3.5 | While disconnected with no remembered instance (clear settings or first run), click the icon. | "Force reconnect" item is **disabled** (greyed) and carries an explanatory tooltip ("No Tomo instance chosen — open Settings → Connect"). Other two items remain enabled. | | | |
| 15 | F3.6 | Click "Open chat window" in the popover. | Chat view opens (or focuses if already open). Same singleton behavior as the F7 palette command. | | | |
| 16 | F3.7 | Click "Go to settings" in the popover. | Obsidian Settings opens, scrolled to the Hashi section. | | | |
| 17 | F3.8 | Toggle macOS *System Settings → Accessibility → Display → Reduce Motion* **on**. Re-trigger any state transition (e.g., disconnect→reconnect cycle). | Status bar icon transitions are **instant** — no pulse/fade animation. The Reconnecting state shows as static (e.g., a frozen indicator) rather than animated. | | | |
| 18 | F3.9 | Enable VoiceOver (Cmd+F5). Navigate to the status bar element with VO+arrow keys. Trigger a state change (e.g., `docker restart hashi-qa-tomo`). | VoiceOver announces the new state via the live region — e.g., "Tomo: qa-test" → "Reconnecting" → "Tomo: qa-test". The element exposes `aria-live="polite"` (verify with VoiceOver Utility's element inspector or Web Inspector). | | | |

### F4 — Chat Window View

| # | AC ref | What to observe | Expected | Observed | Passed (Y/N) | Notes |
|---|---|---|---|---|---|---|
| 19 | F4.1 | Open the chat view via the popover. Drag its tab to the **right sidebar**, then to the **left sidebar**, then to a **main pane** tab. | View renders correctly in all three positions. xterm terminal area resizes responsively; cursor blinks; line edits work; no scrollbar artifacts; no layout breakage. | | | |
| 20 | F4.4 | While disconnected, open the chat view. Click the "Connect" link in the Not-Connected state. | Obsidian Settings opens, scrolled to the Hashi section. Same surface as F3.7. | | | |
| 21 | F4.5 | Connect, then type "echo hello" + Enter in the chat input. | Input text appears in the rendered terminal; the container's stdout (`hello\n`) is rendered in xterm; no double-echo, no lost characters; cursor advances. | | | |
| 22 | F4.6 | While connected, paste a string containing an Obsidian URI like `obsidian://open?vault=Hashi&file=test` into the chat input and Enter. (Or have the container output it: `echo 'obsidian://open?vault=Hashi'`.) | The URI is rendered as **plain text** in the terminal. No automatic activation, no link click affordance, no command routing. | | | |
| 23 | F4.8 | While connected, have the container emit OSC 8 hyperlink and OSC 52 clipboard sequences: `printf '\x1b]8;;https://example.com\x07click\x1b]8;;\x07\n'` and `printf '\x1b]52;c;aGVsbG8=\x07\n'`. | xterm renders text but does **not** make the URL clickable (no underline, no pointer cursor on hover). The system clipboard is **not** modified by the OSC 52 sequence (verify with `pbpaste` before/after). | | | |

### F5 — Chat Window: Status Indicator and Force Reconnect

| # | AC ref | What to observe | Expected | Observed | Passed (Y/N) | Notes |
|---|---|---|---|---|---|---|
| 24 | F5.2 | Connect, then `docker restart hashi-qa-tomo`. While the in-view banner shows "Reconnecting (attempt N)…", press Tab from the chat input. | Force Reconnect button receives keyboard focus (visible focus ring). Enter activates it. Reachable in ≤ 3 Tab presses from the input. | | | |
| 25 | F5.5 | Connect, `docker restart hashi-qa-tomo`, wait for the reconnect loop to succeed and return to Connected. Look at the in-view indicator. | The user is informed that a disconnection occurred (e.g., a sticky banner "Reconnected after N seconds — output during gap not replayed", or a small badge until dismissed). **KNOWN GAP per traceability.md F5.5/F8.5** — if the indicator silently reverts to "Connected — qa-test" with no gap message, mark `N` and note "F5.5/F8.5 follow-up TDD task required". | | | Same root cause as row 31 (F8.5). |
| 26 | F5.6 | While in each state (connected / reconnecting / disconnected), inspect the in-view indicator. Repeat with macOS Reduce Motion **on**. | Severity is conveyed via icon **and** text, not color alone. Reconnecting animation is suppressed under reduced-motion. | | | |
| 27 | F5.7 | With VoiceOver active and the chat view focused, trigger a state change. | VoiceOver announces the indicator change. Transitional changes use `aria-live="polite"` (e.g., reconnecting); error/disconnected uses `aria-live="assertive"`. | | | |

### F7 — Command Palette: Show Chat Window

| # | AC ref | What to observe | Expected | Observed | Passed (Y/N) | Notes |
|---|---|---|---|---|---|---|
| 28 | F7.2 | Open the chat view, drag it to the **left sidebar**, close the leaf. Quit Obsidian. Reopen the vault. Run "Tomo Hashi: Show chat window" from the palette. | Chat view opens in the **left sidebar** (its last-known location). Input is focused. | | | |

### F8 — Automatic Reconnect on Transient Disconnect

| # | AC ref | What to observe | Expected | Observed | Passed (Y/N) | Notes |
|---|---|---|---|---|---|---|
| 29 | F8.5 | Connect, `docker restart hashi-qa-tomo`, observe the indicator during the reconnect window AND after success. | Banner shows "Reconnecting (attempt N)…" during the loop. After successful recovery, the user is informed that a gap occurred. **KNOWN GAP per traceability.md** — same as row 25 (F5.5). If the indicator silently goes back to "Connected — qa-test", mark `N` and note "F5.5/F8.5 follow-up TDD task required". | | | |

### F9 — Error Surfacing

| # | AC ref | What to observe | Expected | Observed | Passed (Y/N) | Notes |
|---|---|---|---|---|---|---|
| 30 | F9.1 | With chat view open and connected, force an error (e.g., `docker rm -f hashi-qa-tomo` to trigger reconnect-exhausted). | Error surfaced in a sticky in-view indicator banner. Banner persists until the user resolves (Force Reconnect succeeds) or dismisses (× button). Does NOT auto-dismiss on a timer. | | | |
| 31 | F9.5 | Trigger each error class (daemon-not-reachable, socket-permission-denied, no-instances, chosen-instance-gone, stream-error). Repeat with Reduce Motion + VoiceOver on. | Error severity conveyed via icon + text (not color alone). Reduced-motion suppresses any error-state animation. VoiceOver announces each error message. | | | |
| 32 | F9.6 | Manual grep walkthrough: `rg -n 'logger\.(info\|warn\|error\|debug)\((.*?(chunk\|data\|stdout\|stderr))' src/connection/ src/ui/chat-view/`. | Zero matches. (PRD-mandated invariant: no chat content logged.) **Strong follow-up per traceability.md**: replace this manual row with an automated grep test. | | | If the grep test lands before this QA pass, mark `Y` and note "automated by test/unit/no-chat-content-logged.test.ts" |

### FS1 — File Right-Click → Chat with @file Reference

| # | AC ref | What to observe | Expected | Observed | Passed (Y/N) | Notes |
|---|---|---|---|---|---|---|
| 33 | FS1.1 + FS1.5 (.md) | Right-click any `.md` file in the file explorer. | Context menu shows "Open Tomo chat with @file reference" entry. Clicking it inserts `@<vault-relative-path> ` (with trailing space) at caret in the chat input. Focus moves to the input. | | | |
| 34 | FS1.5 (.pdf) | Drop a `.pdf` into the vault. Right-click it. | Same entry appears; same prefill behavior with the `.pdf` path. | | | |
| 35 | FS1.5 (.png) | Drop a `.png` into the vault. Right-click it. | Same entry appears; same prefill behavior with the `.png` path. | | | |
| 36 | FS1.4 | While disconnected, right-click any file → "Open Tomo chat with @file reference". | Chat view opens in Not-Connected state. Prefill `@<path> ` is present in the input. A reminder ("Connect a Tomo instance to send.") is visible near the input. | | | |

### FS2 — Remember Last Connected Instance Across Sessions

| # | AC ref | What to observe | Expected | Observed | Passed (Y/N) | Notes |
|---|---|---|---|---|---|---|
| 37 | FS2.3 | Connect to `qa-test`. Quit Obsidian. **Stop the Docker daemon** (so it's not yet ready when Obsidian reopens). Reopen the vault. | Hashi attempts auto-reconnect, fails (daemon not ready), stops retrying, lands in Disconnected with the in-view Force Reconnect path. Does NOT loop indefinitely. | | | |

## After completion

- **All `Y`** → set frontmatter `status: passed`. Notify T5.9 that this gate is met.
- **Any `N`** → describe the failure in the row's `Notes`, file a follow-up TDD task, and add a row to the spec README's Decisions Log per the deviation protocol. Re-run the affected row after the fix.
- **Re-run** after any UI-touching change to spec 001.

## Cleanup

```bash
docker rm -f hashi-qa-tomo 2>/dev/null
docker ps --filter label=miyo.component=tomo -q | xargs -r docker rm -f
```

## Cross-references

- Plan: `docs/XDD/specs/001-session-view/plan/phase-5.md` §T5.5b
- Traceability: `docs/XDD/specs/001-session-view/plan/traceability.md` (every `M:row Fx.y` reference resolves to a row in this file)
- SDD ADRs: ADR-3 (plain TS rendering), ADR-6 (singleton view), ADR-9 (Menu popover)
- Deviation protocol: `docs/XDD/specs/001-session-view/plan/README.md`
