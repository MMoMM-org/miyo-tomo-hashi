/**
 * outcomeSource — resolves the per-action outcomes the Instruction Fixer's
 * edit gate is allowed to trust (spec-006, ADR-4).
 *
 * Why this file exists: there is NO durable per-action outcome store. On disk
 * `failed`, `skipped-dependency`, `skipped-cancelled` and never-run all
 * collapse to the same thing — `applied` simply isn't `true`. This resolver is
 * the only place that can tell them apart, and its answer directly decides
 * whether an action is editable (`editGate`, T2.2).
 *
 * Two trusted sources, in priority order:
 *   1. the in-session `executionStore` summary, when it covers this exact set;
 *   2. otherwise the newest run log whose frontmatter `sources:` includes this
 *      exact set path, parsed row by row out of that set's own table section.
 * Anything else — no log, an unreadable log, a log about another set, a log
 * without a section for this set — is `NO_TRUSTED_SIGNAL`.
 *
 * The bias is deliberately asymmetric: a false negative costs the user one
 * click on "Run"; a false positive would unlock editing on actions that never
 * failed and defeat the fail-closed guarantee. So path matching is EXACT — no
 * basename, prefix, case-insensitive or otherwise normalized match — and a log
 * we cannot fully understand is refused rather than mapped optimistically.
 *
 * Pure with respect to its injected `deps` (vault + run-state accessor), so it
 * is testable without an Obsidian runtime or the module-level store singleton.
 *
 * [ref: SDD/ADR-4; SDD/Interface Specifications/outcomeSource; SDD/Runtime
 * View/Secondary Flow; SDD/Implementation Gotchas — run-log source matching]
 */

import type { ActionOutcome, RunState } from "../../executor/state.js";
import type { InstructionSet } from "../../schema/types.js";
import type { VaultFS } from "../../vault/VaultFS.js";

/** Action id as it appears in the set and the run log (`I01`, `I12`, …). */
export type ActionId = string;

/**
 * "No source we are willing to trust." A plain string literal so consumers can
 * compare with `===` and TypeScript narrows the union on both branches.
 */
export const NO_TRUSTED_SIGNAL = "no-trusted-signal" as const;
export type NoTrustedSignal = typeof NO_TRUSTED_SIGNAL;

/** What `resolveOutcomes` returns: a trusted map, or the fail-closed sentinel. */
export type OutcomeResolution = ReadonlyMap<ActionId, ActionOutcome> | NoTrustedSignal;

export interface OutcomeSourceDeps {
	/** Read side of the vault only — this resolver never writes. */
	readonly vault: Pick<VaultFS, "list" | "read">;
	/** Accessor over the executionStore's current state (injected for testability). */
	readonly getRunState: () => RunState;
	/** Folder run logs are written into — the configured Tomo inbox folder. */
	readonly logFolder: string;
}

/**
 * Resolve the trusted outcome of each action of `set` as executed from
 * `sourcePath`, or `NO_TRUSTED_SIGNAL` when no source qualifies.
 *
 * An outcome missing from a returned map means "not attempted" (pending) —
 * which the gate treats as read-only, same as no signal at all.
 */
export async function resolveOutcomes(
	set: InstructionSet,
	sourcePath: string,
	deps: OutcomeSourceDeps,
): Promise<OutcomeResolution> {
	const knownIds = new Set(set.actions.map((action) => action.id));

	const fromSummary = outcomesFromSummary(deps.getRunState(), sourcePath, knownIds);
	if (fromSummary !== null) return fromSummary;

	const fromLog = await outcomesFromRunLog(sourcePath, knownIds, deps);
	if (fromLog !== null) return fromLog;

	return NO_TRUSTED_SIGNAL;
}

// ---------------------------------------------------------------------------
// Source 1 — the in-session executionStore summary
// ---------------------------------------------------------------------------

/**
 * Outcomes off a finished in-session run, or null when the store holds nothing
 * that covers this set. Only the terminal `summary` state counts: `running`
 * and `previewing` carry outcomes that are still moving, and trusting a
 * mid-flight `failed` would unlock an action the executor may yet apply.
 */
function outcomesFromSummary(
	state: RunState,
	sourcePath: string,
	knownIds: ReadonlySet<ActionId>,
): ReadonlyMap<ActionId, ActionOutcome> | null {
	if (state.kind !== "summary") return null;

	const map = new Map<ActionId, ActionOutcome>();
	let covered = false;

	for (const record of state.records) {
		// fileId IS the source path for executor-resolved sources
		// (InstructionExecutor.validateAllSources sets both from the same value).
		if (record.fileId !== sourcePath) continue;
		covered = true;
		if (record.outcome === null) continue;
		if (!knownIds.has(record.id)) continue;
		map.set(record.id, record.outcome);
	}

	// A run that never touched this set says nothing about it — fall through to
	// the run log rather than reporting an empty (and therefore all-read-only)
	// map as if it were this set's own result.
	return covered ? map : null;
}

// ---------------------------------------------------------------------------
// Source 2 — the newest confidently source-matched run log
// ---------------------------------------------------------------------------

/**
 * `tomo-hashi-run-log_YYYY-MM-DDTHHMM.md`, plus the `_N` collision suffix
 * `resolveCollisionFreePath` appends for a second run in the same minute.
 */
const RUN_LOG_FILENAME_RE = /^tomo-hashi-run-log_(\d{4}-\d{2}-\d{2}T\d{4})(?:_(\d+))?\.md$/;

interface LogCandidate {
	readonly path: string;
	readonly stamp: string;
	readonly collision: number;
}

async function outcomesFromRunLog(
	sourcePath: string,
	knownIds: ReadonlySet<ActionId>,
	deps: OutcomeSourceDeps,
): Promise<ReadonlyMap<ActionId, ActionOutcome> | null> {
	let children: readonly string[];
	try {
		children = await deps.vault.list(deps.logFolder);
	} catch {
		// Missing/unreadable folder — no signal, not an error to surface here.
		return null;
	}

	for (const candidate of sortNewestFirst(children)) {
		let raw: string;
		try {
			raw = await deps.vault.read(candidate.path);
		} catch {
			// We never learned whether this one matched, so it cannot mask the
			// older logs — keep looking rather than claiming "no signal".
			continue;
		}
		if (!sourcesInclude(raw, sourcePath)) continue;

		// The newest matching log IS the last word on this set. If its table
		// cannot be located, refuse — falling back to an older log here would
		// present superseded outcomes as current.
		return parseSectionRows(raw, sourcePath, knownIds);
	}

	return null;
}

/** Run-log files in the folder, newest first (timestamp, then collision index). */
function sortNewestFirst(children: readonly string[]): LogCandidate[] {
	const candidates: LogCandidate[] = [];
	for (const path of children) {
		const match = RUN_LOG_FILENAME_RE.exec(basename(path));
		if (match === null) continue;
		candidates.push({
			path,
			stamp: match[1] ?? "",
			collision: match[2] === undefined ? 1 : Number(match[2]),
		});
	}
	return candidates.sort((a, b) =>
		a.stamp === b.stamp ? b.collision - a.collision : b.stamp.localeCompare(a.stamp),
	);
}

function basename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * True iff the log's frontmatter `sources:` list holds `sourcePath` EXACTLY.
 *
 * No normalization of any kind (SDD gotcha "run-log source matching"): a
 * basename, prefix or case-insensitive match could bind a stale or unrelated
 * log to this set, which is the one failure this whole module exists to avoid.
 */
function sourcesInclude(raw: string, sourcePath: string): boolean {
	const lines = raw.split("\n");
	if (lines[0]?.trim() !== "---") return false;

	let inSources = false;
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.trim() === "---") return false; // end of frontmatter, no match
		if (!inSources) {
			if (line.trim() === "sources:") inSources = true;
			continue;
		}
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (item === null) {
			// The list ended and this line is the next frontmatter key.
			inSources = line.trim() === "sources:";
			continue;
		}
		if (item[1]?.trim() === sourcePath) return true;
	}
	return false;
}

/**
 * The rows of the `## <sourcePath>` section, mapped by action id. Returns null
 * when the section is absent — a log we cannot read is not a log we trust.
 */
function parseSectionRows(
	raw: string,
	sourcePath: string,
	knownIds: ReadonlySet<ActionId>,
): ReadonlyMap<ActionId, ActionOutcome> | null {
	const lines = raw.split("\n");
	const heading = `## ${sourcePath}`;
	let index = lines.findIndex(
		(line) => line.trimEnd() === heading || line.trimEnd() === `${heading} (validation failed)`,
	);
	if (index === -1) return null;

	const map = new Map<ActionId, ActionOutcome>();
	for (index += 1; index < lines.length; index++) {
		const line = (lines[index] ?? "").trim();
		if (line.startsWith("## ")) break; // next file section
		if (!line.startsWith("|")) continue;

		const cells = splitRow(line);
		const id = parseIdCell(cells[0] ?? "");
		if (id === null) continue; // header, divider, or a validation-failure row
		if (!knownIds.has(id)) continue; // an id this set no longer has
		const outcome = parseOutcome(cells[3] ?? "", cells[4] ?? "");
		if (outcome === null) continue; // `pending` or unrecognised — no signal
		map.set(id, outcome);
	}

	return map;
}

/**
 * Split one Markdown table row into its cells. `renderEntryRow` escapes literal
 * pipes as `\|`; park those on a sentinel so they don't split the row, then
 * restore them in the cell values.
 */
const ESCAPED_PIPE = "\u0000";

function splitRow(line: string): string[] {
	const parked = line.replace(/\\\|/g, ESCAPED_PIPE);
	const inner = parked.replace(/^\|/, "").replace(/\|$/, "");
	return inner.split("|").map((cell) => cell.split(ESCAPED_PIPE).join("|").trim());
}

/**
 * The action id of a row, or null when the row carries none (table header,
 * divider, or the `| — | — | (validation failure) | … |` row).
 *
 * Two cell forms are accepted: the plain `I##` (ADR-8) and the wikilink
 * `[[<peerStem>#<heading>|I##]]` older/current logs still carry.
 */
function parseIdCell(cell: string): ActionId | null {
	if (/^I\d+$/.test(cell)) return cell;
	const wikilink = /^\[\[.*\|(I\d+)\]\]$/.exec(cell);
	return wikilink?.[1] ?? null;
}

/**
 * The outcome column (plus the error column, for `failed`) as an ActionOutcome.
 *
 * The error column can also carry `renderEntryRow`'s appended after-hook
 * failure / hook note; they ride along in `reason` because they are part of
 * what the run reported about that action, and the card shows the reason
 * verbatim.
 */
function parseOutcome(outcomeCell: string, errorCell: string): ActionOutcome | null {
	if (outcomeCell === "applied") return { kind: "applied" };
	if (outcomeCell === "skipped-already") return { kind: "skipped-already" };
	if (outcomeCell === "skipped-cancelled") return { kind: "skipped-cancelled" };
	if (outcomeCell === "failed") return { kind: "failed", reason: errorCell };

	const dependency = /^skipped-dependency(?:\s+\(dependsOn:\s*(.*)\))?$/.exec(outcomeCell);
	if (dependency !== null) return { kind: "skipped-dependency", dependsOn: dependency[1] ?? "" };

	// `pending` and anything unrecognised carry no trustworthy signal.
	return null;
}
