/**
 * ObsidianSuggestionsDoc — the real SuggestionsDoc adapter (spec-004 Phase 2,
 * T2.1/T2.2; SDD §4/§9, ADR-S4/ADR-S5).
 *
 * The ONE wire-aware file outside src/schema/ (ADR-S5): this is where
 * `_suggestions.json` gets parsed into the whole-document `EditModel` and
 * where an edited `EditModel` gets written back (JSON + a courtesy markdown
 * re-render). Every other Suggestions Editor piece (store, transforms,
 * views) operates purely on `EditModel`.
 *
 * Depends on the `VaultFS` port (constructor-injected), never on raw
 * `app.vault` — keeps this unit-testable against `FakeVaultFS` without a
 * real Obsidian app (Constitution L1). The only `obsidian` import is
 * `Notice`, and even that is injectable (mirrors
 * src/ui/status-bar/StatusBarIcon.ts's `copyAuthToken` pattern) so tests
 * never need the real Obsidian `Notice`.
 */

import { Notice } from "obsidian";

import type {
	DailyUpdateWire,
	EditModel,
	SuggestionsWire,
	SuggestionWire,
	TagGroupWire,
} from "../types/suggestions.js";
import { validate } from "../schema/suggestions-validator.js";
import type { SuggestionsDoc } from "../vault/SuggestionsDoc.js";
import type { VaultFS } from "../vault/VaultFS.js";

export class ObsidianSuggestionsDoc implements SuggestionsDoc {
	// Stateful — one active doc at a time (SDD §9). Set by load(), read by
	// save() so the caller never has to re-pass the path.
	private docPath: string | null = null;

	constructor(
		private readonly vault: VaultFS,
		private readonly notify: (msg: string) => void = (m) => {
			new Notice(m);
		},
	) {}

	async load(docPath: string): Promise<EditModel> {
		const raw = await this.readAndParse(docPath);
		const result = validate(raw);
		if (!result.ok) {
			// Fail loud (ADR-025 discipline) — the caller falls back to the
			// markdown path; this adapter's job is only to refuse to hand
			// back a doc that doesn't match the pinned wire schema.
			throw new Error(`ObsidianSuggestionsDoc.load(${docPath}): ${result.message}`);
		}
		this.docPath = docPath;
		return { doc: result.data, dirty: false };
	}

	async save(model: EditModel): Promise<void> {
		// Dirty gate (ADR-S4 #3): an untouched doc stays byte-stable so Tomo
		// keeps the markdown path. This function never assigns to `model` on
		// any path, success or failure — "rebuild-and-replace" is free.
		if (!model.dirty) return;
		const docPath = this.requireActiveDocPath();
		const mdPath = courtesyMdPath(docPath);
		const json = JSON.stringify(model.doc, null, 2) + "\n";

		try {
			// Whole-document write (ADR-S4 #1/#2): emit_digest and every
			// read-only/daily/tag-handler field ride along verbatim because
			// they are fields on `model.doc` that this transform never touches.
			await this.vault.process(docPath, () => json);
			await this.vault.process(mdPath, () => renderCourtesyMarkdown(model));
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			this.notify(`Could not save suggestions to ${docPath}: ${reason}`);
			throw err;
		}
	}

	private requireActiveDocPath(): string {
		if (this.docPath === null) {
			throw new Error(
				"ObsidianSuggestionsDoc.save(): no active document — call load() first",
			);
		}
		return this.docPath;
	}

	private async readAndParse(docPath: string): Promise<unknown> {
		const text = await this.vault.read(docPath);
		try {
			return JSON.parse(text);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			throw new Error(
				`ObsidianSuggestionsDoc.load(${docPath}): invalid JSON — ${reason}`,
			);
		}
	}
}

/**
 * Derive the sibling `_suggestions.md` courtesy path from the `.json` path
 * Tomo always emits them as a pair (SDD §1) — falls back to appending
 * `.md` if handed a path that doesn't end in `.json`.
 */
function courtesyMdPath(docPath: string): string {
	return docPath.endsWith(".json")
		? `${docPath.slice(0, -".json".length)}.md`
		: `${docPath}.md`;
}

// ---------------------------------------------------------------------------
// Courtesy markdown — a deliberately minimal, deterministic summary of the
// EDITED state. NOT an attempt to reproduce Tomo's `_suggestions.md` format:
// Tomo's `build_from_wire` overwrites this file on the next `/inbox` run
// regardless (JSON is authoritative — Pass 2 is JSON-only). This exact
// format is a design choice open to review, not a wire contract.
// ---------------------------------------------------------------------------

/** Pure, deterministic — same EditModel in, same markdown string out. */
export function renderCourtesyMarkdown(model: EditModel): string {
	const { doc } = model;
	return [
		renderHeader(doc),
		renderSummary(doc),
		renderSuggestionsSection(doc.suggestions),
		renderProposedMocsSection(doc.proposed_mocs),
		renderDailyUpdatesSection(doc.daily_updates),
		renderTagGroupsSection(doc.tag_handler_groups),
	].join("\n");
}

function renderHeader(doc: SuggestionsWire): string {
	return [
		`# Suggestions — ${doc.run_id}`,
		"",
		"_Edited in Hashi — the sibling `.json` is authoritative; run `/inbox` for Pass 2 to apply these edits._",
		"",
	].join("\n");
}

function renderSummary(doc: SuggestionsWire): string {
	const suggestionsApproved = doc.suggestions.filter((s) => s.decision === "approve").length;
	const mocsApproved = doc.proposed_mocs.filter((m) => m.decision === "approve").length;
	const logEntryCount = doc.daily_updates.reduce((n, d) => n + d.log_entries.length, 0);
	const tagApproved = doc.tag_handler_groups.filter((g) => g.approved).length;
	return [
		"## Summary",
		"",
		`- Suggestions: ${doc.suggestions.length} (${suggestionsApproved} approve / ${doc.suggestions.length - suggestionsApproved} skip)`,
		`- Proposed MOCs: ${doc.proposed_mocs.length} (${mocsApproved} approve / ${doc.proposed_mocs.length - mocsApproved} skip)`,
		`- Daily updates: ${doc.daily_updates.length} date(s), ${logEntryCount} log entr${logEntryCount === 1 ? "y" : "ies"}`,
		`- Tag-handler groups: ${doc.tag_handler_groups.length} (${tagApproved} approved)`,
		"",
	].join("\n");
}

function renderSuggestionsSection(suggestions: readonly SuggestionWire[]): string {
	const lines =
		suggestions.length === 0
			? ["(none)"]
			: suggestions.map((s) => `- ${s.id} · ${s.title} · ${s.decision} · MOCs: ${selectedMocPaths(s)}`);
	return ["## Suggestions", "", ...lines, ""].join("\n");
}

function selectedMocPaths(s: SuggestionWire): string {
	const selected = s.candidate_mocs.filter((m) => m.selected).map((m) => m.path);
	return selected.length === 0 ? "(none selected)" : selected.join(", ");
}

function renderProposedMocsSection(mocs: SuggestionsWire["proposed_mocs"]): string {
	const lines =
		mocs.length === 0
			? ["(none)"]
			: mocs.map((m) => `- ${m.id} · ${m.name} · ${m.decision}`);
	return ["## Proposed MOCs", "", ...lines, ""].join("\n");
}

function renderDailyUpdatesSection(dailyUpdates: readonly DailyUpdateWire[]): string {
	const lines = dailyUpdates.flatMap((d) =>
		d.log_entries.map((entry) => `- ${d.date} · ${entry.content} · accepted: ${entry.accepted}`),
	);
	return ["## Daily Updates", "", ...(lines.length === 0 ? ["(none)"] : lines), ""].join("\n");
}

function renderTagGroupsSection(groups: readonly TagGroupWire[]): string {
	const lines =
		groups.length === 0
			? ["(none)"]
			: groups.map((g) => `- ${g.group_id} · approved: ${g.approved}`);
	return ["## Tag-Handler Groups", "", ...lines, ""].join("\n");
}
