/**
 * RunLogWriter — writes per-run Markdown log files into the tomo-inbox folder.
 *
 * API:
 *   start(meta)                 → choose non-colliding path, write placeholder, return path
 *   appendRecord(record)        → buffer one ActionRecord
 *   appendValidationFailure(f)  → buffer a validation-only failure for a file
 *   finalize(endedAt, retention) → overwrite file with full content; trash if retention rule applies
 *
 * No crypto, no obsidian imports.
 *
 * [ref: PRD/F7; SDD/ADR-8; T4.3]
 */

import type { VaultFS } from "../vault/VaultFS.js";
import type { ActionRecord, ExecutionMode } from "./state.js";
import { buildRunLogFilename, resolveCollisionFreePath } from "../util/filenames.js";

export type RunLogRetention = "always" | "only-after-failed";

export interface RunLogStartMeta {
	readonly inboxFolder: string;
	readonly startedAt: Date;
	readonly mode: ExecutionMode;
	readonly sources: readonly string[];
}

export interface ValidationFailure {
	readonly fileId: string;
	readonly message: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type BufferedEntry =
	| { readonly kind: "record"; readonly record: ActionRecord }
	| { readonly kind: "validation"; readonly failure: ValidationFailure };

// ---------------------------------------------------------------------------
// RunLogWriter
// ---------------------------------------------------------------------------

export class RunLogWriter {
	private readonly vault: VaultFS;
	private logPath: string | null = null;
	private meta: RunLogStartMeta | null = null;
	private readonly entries: BufferedEntry[] = [];

	constructor(vault: VaultFS) {
		this.vault = vault;
	}

	async start(meta: RunLogStartMeta): Promise<string> {
		this.meta = meta;
		const baseFilename = buildRunLogFilename(meta.startedAt);
		const path = await resolveCollisionFreePath(this.vault, meta.inboxFolder, baseFilename);
		this.logPath = path;

		await this.vault.create(path, renderPlaceholder(meta));
		return path;
	}

	appendRecord(record: ActionRecord): void {
		this.entries.push({ kind: "record", record });
	}

	appendValidationFailure(failure: ValidationFailure): void {
		this.entries.push({ kind: "validation", failure });
	}

	async finalize(endedAt: Date, retention: RunLogRetention): Promise<void> {
		if (this.logPath === null || this.meta === null) {
			throw new Error("RunLogWriter.finalize called before start");
		}

		const content = renderLog(this.meta, endedAt, this.entries);
		await this.vault.process(this.logPath, () => content);

		if (retention === "only-after-failed" && countFailures(this.entries) === 0) {
			await this.vault.trash(this.logPath);
		}
	}
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function renderPlaceholder(meta: RunLogStartMeta): string {
	return renderFrontmatter(meta, null, null) + "\n# Hashi run log\n";
}

function renderLog(
	meta: RunLogStartMeta,
	endedAt: Date,
	entries: readonly BufferedEntry[],
): string {
	const totals = computeTotals(entries);
	const front = renderFrontmatter(meta, endedAt, totals);
	const body = renderBody(meta.sources, entries);
	return `${front}\n# Hashi run log\n\n${body}`;
}

function renderFrontmatter(
	meta: RunLogStartMeta,
	endedAt: Date | null,
	totals: Totals | null,
): string {
	const startIso = formatIso(meta.startedAt);
	const endIso = endedAt !== null ? formatIso(endedAt) : "";
	const sourcesYaml = meta.sources.map((s) => `  - ${s}`).join("\n");

	const totalsYaml =
		totals !== null
			? [
					`  applied: ${totals.applied}`,
					`  skipped-already: ${totals["skipped-already"]}`,
					`  skipped-dependency: ${totals["skipped-dependency"]}`,
					`  skipped-cancelled: ${totals["skipped-cancelled"]}`,
					`  failed: ${totals.failed}`,
			  ].join("\n")
			: "  {}";

	return [
		"---",
		`started: ${startIso}`,
		`ended:   ${endIso}`,
		`mode: ${meta.mode}`,
		"sources:",
		sourcesYaml,
		"totals:",
		totalsYaml,
		"---",
	].join("\n");
}

function renderBody(
	sources: readonly string[],
	entries: readonly BufferedEntry[],
): string {
	const sections: string[] = [];

	for (const fileId of sources) {
		const fileEntries = entries.filter((e) => entryFileId(e) === fileId);
		sections.push(renderFileSection(fileId, fileEntries));
	}

	// Files that appear in entries but not in sources list (edge case guard)
	const covered = new Set(sources);
	const extra = new Set(entries.map(entryFileId).filter((id) => !covered.has(id)));
	for (const fileId of extra) {
		const fileEntries = entries.filter((e) => entryFileId(e) === fileId);
		sections.push(renderFileSection(fileId, fileEntries));
	}

	return sections.join("\n");
}

function renderFileSection(fileId: string, entries: readonly BufferedEntry[]): string {
	const hasValidationFailure = entries.some((e) => e.kind === "validation");
	const heading = hasValidationFailure
		? `## ${fileId} (validation failed)`
		: `## ${fileId}`;

	const header = "| I##  | kind | summary | outcome | error |";
	const divider = "|------|------|---------|---------|-------|";
	const rows = entries.map(renderEntryRow);

	return [heading, "", header, divider, ...rows, ""].join("\n");
}

function renderEntryRow(entry: BufferedEntry): string {
	if (entry.kind === "validation") {
		const msg = entry.failure.message;
		return `| — | — | (validation failure) | failed | ${msg} |`;
	}

	const { id, kind, summary, outcome } = entry.record;
	const outcomeStr = outcome !== null ? outcome.kind : "pending";
	const error = outcome !== null && outcome.kind === "failed" ? outcome.reason : "";
	const depNote =
		outcome !== null && outcome.kind === "skipped-dependency"
			? ` (dependsOn: ${outcome.dependsOn})`
			: "";

	return `| ${id} | ${kind} | ${summary} | ${outcomeStr}${depNote} | ${error} |`;
}

function entryFileId(entry: BufferedEntry): string {
	return entry.kind === "record" ? entry.record.fileId : entry.failure.fileId;
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

interface Totals {
	applied: number;
	"skipped-already": number;
	"skipped-dependency": number;
	"skipped-cancelled": number;
	failed: number;
}

function computeTotals(entries: readonly BufferedEntry[]): Totals {
	const t: Totals = {
		applied: 0,
		"skipped-already": 0,
		"skipped-dependency": 0,
		"skipped-cancelled": 0,
		failed: 0,
	};

	for (const entry of entries) {
		if (entry.kind === "validation") {
			t.failed++;
			continue;
		}
		const { outcome } = entry.record;
		if (outcome === null) continue;
		switch (outcome.kind) {
			case "applied": t.applied++; break;
			case "skipped-already": t["skipped-already"]++; break;
			case "skipped-dependency": t["skipped-dependency"]++; break;
			case "skipped-cancelled": t["skipped-cancelled"]++; break;
			case "failed": t.failed++; break;
		}
	}

	return t;
}

function countFailures(entries: readonly BufferedEntry[]): number {
	return computeTotals(entries).failed;
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

function formatIso(d: Date): string {
	const year = String(d.getFullYear());
	const month = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	const hours = String(d.getHours()).padStart(2, "0");
	const minutes = String(d.getMinutes()).padStart(2, "0");
	const seconds = String(d.getSeconds()).padStart(2, "0");
	return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}
