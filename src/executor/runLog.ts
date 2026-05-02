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

/**
 * Bump on any breaking change to the run-log frontmatter or table shape
 * (review M16). Future tooling (Tomo, Kokoro, dashboards) keys on this
 * to detect and adapt to format changes; missing it would force silent
 * parse-on-best-effort.
 */
const LOG_FORMAT_VERSION = 1;

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
	| {
			readonly kind: "record";
			readonly record: ActionRecord;
			// Optional after-hook failure attached to this record (review M18).
			// Pre-fix the executor synthesized a pseudo-record with id
			// `${id}-after-hook` and pushed it as a separate row — read like
			// two outcomes for one action. Now stays a single row with the
			// hook reason concatenated into the error column.
			readonly afterHookFailure?: { readonly reason: string };
			// Free-form note from a hook's "messages" outcome (review L11).
			// Pre-fix these went to console only; users had no way to diagnose
			// hook info/warnings from the run log.
			readonly hookNote?: string;
	  }
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

	appendRecord(
		record: ActionRecord,
		opts?: {
			afterHookFailure?: { reason: string };
			hookNote?: string;
		},
	): void {
		this.entries.push({
			kind: "record",
			record,
			...(opts?.afterHookFailure !== undefined
				? { afterHookFailure: opts.afterHookFailure }
				: {}),
			...(opts?.hookNote !== undefined ? { hookNote: opts.hookNote } : {}),
		});
	}

	appendValidationFailure(failure: ValidationFailure): void {
		this.entries.push({ kind: "validation", failure });
	}

	async finalize(endedAt: Date, retention: RunLogRetention): Promise<void> {
		if (this.logPath === null || this.meta === null) {
			throw new Error("RunLogWriter.finalize called before start");
		}

		const peerHeadings = await loadPeerHeadings(this.vault, this.meta.sources);
		const content = renderLog(this.meta, endedAt, this.entries, peerHeadings);
		await this.vault.process(this.logPath, () => content);

		// Inlined countFailures (review round 2 / L16) — the helper just
		// re-ran computeTotals to read one field; renderLog already
		// computed the same tally above (line 187), but lifting that into
		// the caller would ripple through renderLog's signature for one
		// number. One extra pass per finalize is cheap; the helper isn't.
		if (
			retention === "only-after-failed" &&
			computeTotals(this.entries).failed === 0
		) {
			await this.vault.trash(this.logPath);
		}
	}
}

// ---------------------------------------------------------------------------
// Peer-heading map — read each source's `.md` peer once, extract `### I##`
// headings so the run log can wikilink each row's I## column to the matching
// peer heading. Soft-fail on missing peer or unreadable file.
// ---------------------------------------------------------------------------

interface PeerHeading {
	readonly headingText: string; // full heading text after `### `, e.g. "I01 — Create MOC: Board Games (MOC)"
	readonly peerStem: string;    // peer filename without path/.md, e.g. "2026-05-01_1008_instructions"
}

const HEADING_RE = /^### ((I\d+)(?:\s.*)?)$/;

async function loadPeerHeadings(
	vault: VaultFS,
	sources: readonly string[],
): Promise<Map<string, Map<string, PeerHeading>>> {
	const out = new Map<string, Map<string, PeerHeading>>();

	for (const sourcePath of sources) {
		if (!sourcePath.endsWith(".json")) continue;
		const peerPath = sourcePath.slice(0, -".json".length) + ".md";
		if (!(await vault.exists(peerPath))) continue;

		let raw: string;
		try {
			raw = await vault.read(peerPath);
		} catch {
			continue;
		}

		const peerStem = basename(peerPath).slice(0, -".md".length);
		const inner = new Map<string, PeerHeading>();
		for (const line of raw.split("\n")) {
			const m = HEADING_RE.exec(line);
			if (m === null) continue;
			const headingText = m[1]!;
			const actionId = m[2]!;
			inner.set(actionId, { headingText, peerStem });
		}
		out.set(sourcePath, inner);
	}

	return out;
}

function basename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
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
	peerHeadings: Map<string, Map<string, PeerHeading>>,
): string {
	const totals = computeTotals(entries);
	const front = renderFrontmatter(meta, endedAt, totals);
	const body = renderBody(meta.sources, entries, peerHeadings);
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
		`log_format_version: ${LOG_FORMAT_VERSION}`,
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
	peerHeadings: Map<string, Map<string, PeerHeading>>,
): string {
	// M9: pre-group entries once (O(E)). Pre-fix did entries.filter per
	// source (O(S*E)) plus another full scan for "extra" file ids. Map
	// preserves insertion order so the orphan loop stays deterministic.
	const byFile = new Map<string, BufferedEntry[]>();
	for (const e of entries) {
		const id = entryFileId(e);
		const list = byFile.get(id) ?? [];
		list.push(e);
		byFile.set(id, list);
	}

	const sections: string[] = [];
	const seen = new Set<string>();

	for (const fileId of sources) {
		seen.add(fileId);
		const fileEntries = byFile.get(fileId) ?? [];
		sections.push(renderFileSection(fileId, fileEntries, peerHeadings.get(fileId)));
	}

	// Edge-case guard: files that appear in entries but not in sources.
	for (const [fileId, fileEntries] of byFile) {
		if (seen.has(fileId)) continue;
		sections.push(renderFileSection(fileId, fileEntries, peerHeadings.get(fileId)));
	}

	return sections.join("\n");
}

function renderFileSection(
	fileId: string,
	entries: readonly BufferedEntry[],
	peerHeadings: Map<string, PeerHeading> | undefined,
): string {
	const hasValidationFailure = entries.some((e) => e.kind === "validation");
	const heading = hasValidationFailure
		? `## ${fileId} (validation failed)`
		: `## ${fileId}`;

	const header = "| I##  | kind | summary | outcome | error |";
	const divider = "|------|------|---------|---------|-------|";
	const rows = entries.map((e) => renderEntryRow(e, peerHeadings));

	return [heading, "", header, divider, ...rows, ""].join("\n");
}

// Markdown-table cells terminate at `|`. Escape literal pipes anywhere
// they may appear in user-derived strings (review M5). bb7d6fb fixed
// idCell only; summary/error/depNote can also carry pipes (alias
// separators in wikilinks, exception messages mentioning regex unions).
// Newlines (review round 2 / L15) also break the table — a hook-emitted
// `info` or `warnings` string carrying \n would terminate the row early
// and leave trailing pipe-free text outside the table; collapse to
// single space before pipe-escape so the row stays valid Markdown.
function escapeCell(s: string): string {
	return s.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|");
}

function renderEntryRow(
	entry: BufferedEntry,
	peerHeadings: Map<string, PeerHeading> | undefined,
): string {
	if (entry.kind === "validation") {
		const msg = entry.failure.message;
		return `| — | — | (validation failure) | failed | ${escapeCell(msg)} |`;
	}

	const { id, kind, summary, outcome } = entry.record;
	const outcomeStr = outcome !== null ? outcome.kind : "pending";
	const baseError =
		outcome !== null && outcome.kind === "failed" ? outcome.reason : "";
	const depNote =
		outcome !== null && outcome.kind === "skipped-dependency"
			? ` (dependsOn: ${outcome.dependsOn})`
			: "";
	// M18: fold the after-hook failure (if any) into the same row's error
	// column. Outcome stays as the handler's outcome (e.g., "applied")
	// because the after-hook ran AFTER the vault commit and doesn't
	// invalidate it; the failure is recorded but does not flip the row's
	// outcome.
	let error = baseError;
	if (entry.afterHookFailure !== undefined) {
		const hookErr = `after-hook failed: ${entry.afterHookFailure.reason}`;
		error = error !== "" ? `${error}; ${hookErr}` : hookErr;
	}
	if (entry.hookNote !== undefined && entry.hookNote !== "") {
		// L11: surface hook info/warnings from "messages" outcomes.
		const note = `hook note: ${entry.hookNote}`;
		error = error !== "" ? `${error}; ${note}` : note;
	}

	const idCell = renderIdCell(id, peerHeadings);
	return `| ${idCell} | ${kind} | ${escapeCell(summary)} | ${escapeCell(outcomeStr + depNote)} | ${escapeCell(error)} |`;
}

function renderIdCell(
	id: string,
	peerHeadings: Map<string, PeerHeading> | undefined,
): string {
	const heading = peerHeadings?.get(id);
	if (heading === undefined) return id;
	// Inside a markdown table cell, `|` ends the column. Escape both the
	// wikilink's alias separator and any pipes that happen to appear in
	// the heading text so the table row stays well-formed.
	const escapedHeading = heading.headingText.replace(/\|/g, "\\|");
	return `[[${heading.peerStem}#${escapedHeading}\\|${id}]]`;
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
