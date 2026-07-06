# Suggestions Editor — Manual QA Checklist (spec-004)

> The editor is fully unit- + integration-tested against the Obsidian mock (1550
> automated tests). This checklist covers what the mock **cannot** verify: live
> DOM, real pickers, real vault reads, and the actual Obsidian workspace. Run it
> once against a real Tomo run before shipping. Tick each row; note anything off.

## Setup

1. Deploy the current build into the test vault:
   ```bash
   HASHI_DEPLOY_VAULT=1 npm run build
   ```
   (Already done for this build — `0.15.0-dev.20260706-1731`.)
2. In the test vault (`test/Hashi`), reload the plugin: hot-reload is enabled
   (`.hotreload` present), or toggle **miyo-tomo-hashi** off/on in Community
   plugins, or reload Obsidian (`Ctrl/Cmd-R`).
3. Open the sample run `100 Inbox/2026-07-06_1115_suggestions.md` (or its
   `.json` sibling) so it is the **active** file.
4. Run the command palette → **"Open suggestions editor"**. The editor should
   open in a split **beside** the note (not a modal, not the sidebar).
   - [ ] Command appears in the palette and opens the editor.
   - [ ] Opening with a NON-suggestions file active shows a Notice
         ("Open a Tomo _suggestions.json (or its .md) first") and does not open.

## Chrome & lifecycle (PRD F1)

- [ ] Four tabs render: **Suggestions (7) · Proposed MOCs (0) · Daily (2) · Tag-Handler (1)** with those counts.
- [ ] Clicking a tab switches content; the active tab is visually indicated (underline).
- [ ] **Proposed MOCs (0)** shows an empty state (no cards).
- [ ] Make any edit, then close the editor leaf → a "Unsaved changes" confirm
      prompt appears. (Known v1 gap: it can prompt but **cannot cancel** the
      close — Obsidian `ItemView.onClose` has no veto hook. Verify the prompt
      shows; the leaf will still close.)

## Suggestions tab — worthy vs suppressed (PRD F2/F6/F7)

Worthy note (e.g. **S07**, not suppressed):
- [ ] Title is an editable text field; edit it → (later) the save reflects it.
- [ ] Template / Location open fuzzy pickers over real vault templates/folders.
- [ ] Tags: existing tags show as chips; **+ Tag** opens a fuzzy picker over vault tags.
- [ ] Candidate MOCs list shows the 3 candidates; selecting one **clears the others** (re-point).
- [ ] **+ Add MOC** opens a fuzzy picker over any vault note; the added MOC appears (source = user).
- [ ] **Set spot…** on a selected candidate opens the SpotPicker (see below).
- [ ] Keep-source toggle + Approve/Skip toggle work.

Suppressed note (e.g. **S01 / S05**, worthiness < 0.5):
- [ ] Card shows a **worthiness badge** + a skip hint + a single **Force Atomic** control.
- [ ] There is **NO** MOC UI, no title/template/location/tags/keep/decision controls on suppressed cards.

## SpotPicker — op 2 (PRD F3)

Pick **Set spot…** on a candidate MOC that is an **existing vault note** with headings/callouts:
- [ ] The picker lists the MOC's **real current** headings + callouts (open the MOC first, add a heading, reopen the picker → the new heading appears — it reads live structure, not a cached list).
- [ ] A **callout** anchor offers **inside / before / after**.
- [ ] A **heading** or **line** anchor offers **before / after** only — **never "inside"**.
- [ ] A MOC with no headings/callouts still offers **End of note** / **New section**.
- [ ] Picking **New section** and typing a name sets that section.

## Proposed MOCs tab (PRD F4/F5)

(1115 has none — use a run with `proposed_mocs`, or trust the automated coverage.)
- [ ] Inline **name** edit works.
- [ ] **Parent** opens a fuzzy picker.
- [ ] **Decision** approve/skip toggle (default skip).
- [ ] Member chips render the **note titles** (hover shows the S## id).
- [ ] **Merge into…** appears only when another proposed MOC shares the same name, and collapses them.

## Daily tab (PRD F8)

- [ ] Each date shows a **click-to-open** link; since the daily notes don't exist
      in the test vault, they show a **"doesn't exist"** state.
- [ ] Clicking opens the daily note (Obsidian creates it on open — **Hashi never creates it**).
- [ ] Per log entry: edit **content**; change **position** (at_time / after_last_line / before_first_line).
- [ ] The **time** field is shown/enabled **only** when position = `at_time`, hidden/disabled otherwise.
- [ ] **Accept** and **Force Atomic** toggles work. (Force-Atomic on a shared stem, e.g. `call-vendor`, should stay consistent with the same note's Suggestions-tab Force-Atomic — toggling one flips the other.)
- [ ] Tracker rows and log-link rows each have a working **Accept** toggle.

## Tag-Handler tab (PRD F9)

- [ ] The card shows read-only context: **handler / target / marker / source paths / preview**.
- [ ] **Approve** and **Keep-source** toggles work (not-approved = skipped).
- [ ] The preview renders as **plain text** (a preview containing `<b>`/`<script>` must NOT render as HTML).

## Save — own the whole document (PRD F10)

After making edits across tabs:
- [ ] Trigger save (via the editor's save affordance / whatever the view exposes). The sibling **`_suggestions.json`** updates.
- [ ] Open the `.json` and confirm your **edits landed**, and that sections you did **not** touch (other suggestions, daily entries, tag groups, `emit_digest`, read-only fields) are **unchanged**.
- [ ] `_suggestions.md` is re-rendered as a Hashi courtesy summary (a concise "edited in Hashi — the `.json` is authoritative" view; Tomo will rebuild the full md on the next `/inbox`).
- [ ] Run Tomo `/inbox` (Pass 2) on the edited run → Tomo rebuilds from the JSON and honours your edits (the real cross-tool check).

## Regression / smoke

- [ ] The Tomo **chat view** and other plugin features still work (no wiring regression).
- [ ] No console errors on open / edit / save.

## Deferred (must NOT be present in v1)

- [ ] There is **no** "apply daily update AND keep the source note" control
      (owner-signed-off out of v1; `accepted` stays apply-and-delete).

---

**Found an issue?** Note the tab, the step, and the observed vs expected behavior.
Layout/visual polish (CSS) and the exact courtesy-`.md` format are intentionally
light for v1 and open to your direction.
