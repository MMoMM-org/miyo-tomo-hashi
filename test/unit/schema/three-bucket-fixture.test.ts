/**
 * The three-bucket fixture — Tomo's run `2026-09-14T12-34-09Z-e048aa`, handed
 * over 2026-09-14 to discharge the obligation our 2026-09-12 `status_note`
 * left open: a run that genuinely populates all three daily buckets, including
 * a real `log_links[]` entry, now that Tomo's markdown parser stopped dropping
 * them.
 *
 * Not a real vault run and therefore not anonymised. Per Tomo's handoff the
 * three notes driving the daily buckets were script-generated for this purpose
 * and the rest of the corpus is the 034 test vault, so — unlike
 * `namesake-run.json` — there is no redaction that could have failed. Vendored
 * verbatim: it arrives at `schema_version: 2` and needed no edit at all.
 *
 * What it exists to hold:
 *   1. All three daily buckets non-empty (trackers 09-08, log entries
 *      09-06/08/09, one log link 09-11).
 *   2. A `target_stem` that differs from its `source_item_key` by more than the
 *      `.md` extension — "Zettelkasten: Verzweigung statt Reihenfolge" carries
 *      a colon the filename on disk cannot. Display text, not a filename.
 *   3. A namesake collision spanning the suggestion/daily boundary: stem
 *      "Test" is `100 Inbox/Images/Test.md` as a suggestion and
 *      `100 Inbox/assets/Test.md` as a log entry. This is the live instance of
 *      the join defect our 2026-09-12 handoff §4 reported and could not test —
 *      see `forceAtomicSync.ts` and `SuggestionsTab.collectDailyLogSources`.
 *
 * What it CANNOT do: no single `daily_updates` entry carries trackers AND a
 * log link together — the three buckets populate on three different dates. A
 * one-entry fan-out case is still unavailable. Tomo offered to generate one
 * (`force_atomic` on the tracker-bearing note, which rewrites its log entry
 * into a log link); we have not asked.
 */

import { describe, expect, it } from "vitest";
import { validate } from "../../../src/schema/suggestions-validator.js";
import fixture from "../../fixtures/suggestions/three-bucket-run.json";

/** Basename minus a trailing `.md` — the sanitised filename a stem would match. */
function stemOf(itemKey: string): string {
	return itemKey.slice(itemKey.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

describe("three-bucket fixture (Tomo run 2026-09-14T12-34-09Z-e048aa)", () => {
	it("validates against the vendored v2 wire", () => {
		const result = validate(fixture);
		expect(result.ok, result.ok ? "" : result.message).toBe(true);
	});

	it("populates all three daily buckets across the document", () => {
		const result = validate(fixture);
		if (!result.ok) throw new Error(result.message);
		const daily = result.data.daily_updates;

		const trackers = daily.flatMap((d) => d.trackers);
		const logEntries = daily.flatMap((d) => d.log_entries);
		const logLinks = daily.flatMap((d) => d.log_links);

		expect(trackers.length).toBeGreaterThan(0);
		expect(logEntries.length).toBeGreaterThan(0);
		expect(logLinks.length).toBeGreaterThan(0);
	});

	it("carries a log link whose target_stem is display text, not its source filename", () => {
		const result = validate(fixture);
		if (!result.ok) throw new Error(result.message);
		const links = result.data.daily_updates.flatMap((d) => d.log_links);

		// The point of the fixture: target_stem names the atomic note that will
		// be CREATED, titled as the thought reads; source_item_key is the note
		// it came FROM, whose filename cannot hold the colon.
		const diverging = links.filter((l) => l.target_stem !== stemOf(l.source_item_key));
		expect(diverging.length).toBeGreaterThan(0);
	});

	it("carries a namesake collision across the suggestion/daily boundary", () => {
		const result = validate(fixture);
		if (!result.ok) throw new Error(result.message);
		const logEntries = result.data.daily_updates.flatMap((d) => d.log_entries);

		// Same display stem, different notes — the shape that made the old
		// stem-keyed joins cross-wire one card's state onto another's.
		const collisions = result.data.suggestions.flatMap((s) =>
			logEntries.filter((e) => e.source_stem === s.stem && e.source_item_key !== s.item_key),
		);
		expect(collisions.length).toBeGreaterThan(0);

		// ...and they differ only by folder, so nothing but the item_key separates them.
		for (const entry of collisions) {
			const twin = result.data.suggestions.find((s) => s.stem === entry.source_stem);
			if (!twin) throw new Error("collision twin vanished");
			expect(stemOf(entry.source_item_key)).toBe(stemOf(twin.item_key));
		}
	});
});
