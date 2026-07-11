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
 *
 * One adapter instance per open document (SDD ADR-S1 "one active doc").
 * `save()` writes to the most-recently-loaded `docPath` — `EditModel`
 * carries no path identity of its own, so the caller (the editor view) owns
 * the single-active-doc invariant: it must not call `load(A)`, `load(B)`,
 * then `save(modelFromA)` and expect A's path to be written to.
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
		const json = JSON.stringify(model.doc, null, 2) + "\n";

		// The JSON write is the durable, load-bearing half of save() (ADR-S4
		// #1/#2): emit_digest and every read-only/daily/tag-handler field ride
		// along verbatim because they are fields on `model.doc` this transform
		// never touches. A failure here is a hard failure — nothing was
		// persisted, so `model` (and its `dirty` flag) must stay exactly as
		// the caller handed it to us.
		try {
			await this.writeFile(docPath, json);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			this.notify(`Could not save suggestions to ${docPath}: ${reason}`);
			throw err;
		}

		// The `.md` re-render carries the two things Tomo actually reads off the
		// markdown (tomo→hashi handoff 2026-07-08): its frontmatter (discovery
		// `byFrontmatter tomo.state=pending-approval`) and the `- [x] Approved`
		// Pass-2 gate. Everything else in the body is Hashi's own view — Tomo
		// never parses it once the JSON was edited (stale emit_digest ⇒
		// build_from_wire, JSON-only). We PRESERVE the existing frontmatter
		// verbatim rather than regenerate it (Hashi can't reconstruct
		// tomo_version/updated_at or foreign linter lines), and write the gate
		// checked because Save is the whole-run approve. This half is
		// non-load-bearing: the JSON above is already durable, so a failure here
		// must NOT read (or behave) like data loss — save() still resolves so
		// the caller can clear `dirty`.
		try {
			const mdPath = courtesyMdPath(docPath);
			const existingMd = (await this.vault.exists(mdPath)) ? await this.vault.read(mdPath) : null;
			await this.writeFile(mdPath, composeCourtesyMarkdown(existingMd, model));
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			this.notify(
				`Suggestions saved; couldn't refresh the courtesy _suggestions.md view: ${reason}`,
			);
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

	/**
	 * Upsert write: `VaultFS.process` requires the file to already exist
	 * (`ObsidianVaultFS.process` throws "File not found" otherwise) and
	 * `VaultFS.create` requires that it does NOT — there is no single
	 * upsert primitive on the port, so both `save()` writes (JSON + courtesy
	 * markdown) go through this helper to get create-or-overwrite semantics.
	 */
	private async writeFile(path: string, content: string): Promise<void> {
		if (await this.vault.exists(path)) await this.vault.process(path, () => content);
		else await this.vault.create(path, content);
	}
}

/**
 * Derive the sibling `_suggestions.md` courtesy path from the `.json` path.
 * Tomo always emits them as a pair (SDD §1), so a `docPath` that doesn't end
 * in `.json` is a programmer error in the caller, not a case to paper over —
 * fail loud rather than silently writing to a made-up `<path>.md`.
 */
function courtesyMdPath(docPath: string): string {
	if (!docPath.endsWith(".json")) {
		throw new Error(
			`ObsidianSuggestionsDoc: expected a ".json" docPath, got "${docPath}"`,
		);
	}
	return `${docPath.slice(0, -".json".length)}.md`;
}

// ---------------------------------------------------------------------------
// Courtesy markdown — the sibling `.md` write-back. Two parts are a CONTRACT
// with Tomo (tomo→hashi handoff 2026-07-08), the rest is a disposable Hashi
// view:
//   1. The YAML frontmatter, PRESERVED VERBATIM from Tomo's emission — Tomo
//      discovers the doc `byFrontmatter tomo.state=pending-approval`, so the
//      `tomo:` block (state + run_id) must never be stripped or rewritten.
//      Hashi can't faithfully regenerate it (no tomo_version/updated_at, plus
//      foreign linter lines), so it carries the original block through.
//   2. A body-level `- [x] Approved` line — Tomo's Pass-2 gate (regex
//      `^- [x] Approved`). Save is the whole-run approve, so it is always
//      written checked; the text after "Approved" is irrelevant to Tomo.
// Everything below is Hashi's own summary and is never parsed by Tomo (edited
// JSON ⇒ stale emit_digest ⇒ build_from_wire, JSON-only). Its exact format is
// a design choice open to review, not a wire contract.
// ---------------------------------------------------------------------------

/**
 * Compose the sibling `.md`. `existing` is the current file content (or null
 * when none exists) — its frontmatter is preserved verbatim; only when there
 * is none does Hashi reconstruct a minimal discovery-capable block. Pure and
 * deterministic for a given (existing, model) pair.
 */
export function composeCourtesyMarkdown(existing: string | null, model: EditModel): string {
	const { doc } = model;
	const frontmatter =
		(existing === null ? null : extractFrontmatter(existing)) ?? reconstructFrontmatter(doc);
	return [
		frontmatter,
		"",
		`# Inbox Suggestions — ${doc.run_id}`,
		"",
		"- [x] Approved",
		"",
		"_Edited in Hashi — the sibling `.json` is authoritative; run `/inbox` for Pass 2 to apply these edits._",
		"",
		renderSummary(doc),
		renderSuggestionsSection(doc.suggestions),
		renderProposedMocsSection(doc.proposed_mocs),
		renderDailyUpdatesSection(doc.daily_updates),
		renderTagGroupsSection(doc.tag_handler_groups),
	].join("\n");
}

/**
 * The leading YAML frontmatter block (both `---` fences included), or null
 * when the content does not open with one. Returned verbatim minus trailing
 * whitespace so `composeCourtesyMarkdown` controls the spacing after it —
 * every inner line, including fields other plugins added, rides through
 * untouched.
 */
export function extractFrontmatter(md: string): string | null {
	const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(md);
	return match === null ? null : match[0].replace(/\s+$/, "");
}

/**
 * A minimal frontmatter carrying just what Tomo's discovery needs
 * (`tomo.state=pending-approval` + `run_id`), reconstructed from the wire
 * when the existing `.md` has none. This is a defensive fallback — the normal
 * path preserves Tomo's original block. Timestamps are quoted to avoid YAML
 * coercing them to date types.
 */
function reconstructFrontmatter(doc: SuggestionsWire): string {
	return [
		"---",
		"type: tomo-suggestions",
		`generated: '${doc.generated}'`,
		`profile: ${doc.profile}`,
		`source_items: ${doc.source_items}`,
		`run_id: '${doc.run_id}'`,
		"tomo:",
		"  doc_type: suggestions",
		"  state: pending-approval",
		`  run_id: '${doc.run_id}'`,
		"---",
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
