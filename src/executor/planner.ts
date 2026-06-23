/**
 * Planner — source resolution, canonical order, applied filter, dependency graph.
 *
 * Responsibilities:
 *   - resolveSingle: resolve the _instructions.json for a "single-file" invocation
 *   - resolveBatch: list all _instructions.json in the configured inbox folder
 *   - computeRemaining: produce the merged execution list (ActionRecord[]) + dependency graph
 *
 * No import 'obsidian' — pure TypeScript on VaultFS port + schema types.
 *
 * [ref: PRD/F1, F6; SDD/Runtime View; Primary Flow; Planner]
 */

import type {
	Action,
	ActionKind,
	AddRelationshipAction,
	CreateMocAction,
	LinkToMocAction,
} from "../schema/types.js";
import type { ActionRecord, ResolvedSource } from "./state.js";
import type { VaultFS } from "../vault/VaultFS.js";

// ---------------------------------------------------------------------------
// Canonical order — PRD F4
// ---------------------------------------------------------------------------

// Canonical action order. add_relationship runs after link_to_moc since both
// modify the same MOC and relationships are typically navigation links on the
// just-linked MOC. insert_under_marker sits beside link_to_moc as the second
// insert primitive (arbitrary-note inserts; no dependency on create_moc).
// Update kinds and source cleanup follow.
const KIND_ORDER: readonly ActionKind[] = [
	"create_moc",
	"move_note",
	"link_to_moc",
	"insert_under_marker",
	"add_relationship",
	"update_tracker",
	"update_log_entry",
	"update_log_link",
	"delete_source",
	"skip",
];

// ---------------------------------------------------------------------------
// InboxNotFoundError
// ---------------------------------------------------------------------------

export class InboxNotFoundError extends Error {
	constructor(public readonly folder: string) {
		super(`Tomo inbox folder not found: ${folder}`);
		this.name = "InboxNotFoundError";
	}
}

// ---------------------------------------------------------------------------
// DependencyEdge
// ---------------------------------------------------------------------------

export interface DependencyEdge {
	readonly dependent: string; // record.id of the link_to_moc action
	readonly dependsOn: string; // record.id of the create_moc action
}

// ---------------------------------------------------------------------------
// resolveSingle
// ---------------------------------------------------------------------------

/**
 * Resolve the single source for a "single-file" invocation from the active file path.
 * Returns the path to the _instructions.json, or null if the path is unrelated.
 *
 * Logic:
 *   1. If path ends with `.json` → check exists; return path or null.
 *   2. If path ends with `.md` → derive sibling: replace `.md` suffix with `.json`.
 *      The SDD documents `md_peer` with "fallback to same-stem .md", so the canonical
 *      peer of `foo_instructions.json` is `foo_instructions.md`.
 *      Check that sibling exists; return it or null.
 *   3. Otherwise → null.
 *
 * Deviation note: both `.json` extension check and `.md` → `.json` swap are documented
 * here. No separate `_instructions.json.md` form is supported (not documented in
 * PRD/SDD). Logged under 2026-04-29 (T4.1) in plan/README.md.
 */
export async function resolveSingle(
	vault: VaultFS,
	activeFilePath: string,
): Promise<string | null> {
	if (activeFilePath.endsWith(".json")) {
		return (await vault.exists(activeFilePath)) ? activeFilePath : null;
	}

	if (activeFilePath.endsWith(".md")) {
		const sibling = activeFilePath.slice(0, -3) + ".json";
		return (await vault.exists(sibling)) ? sibling : null;
	}

	return null;
}

// ---------------------------------------------------------------------------
// resolveBatch
// ---------------------------------------------------------------------------

/**
 * Resolve all _instructions.json files in the inbox folder (alphabetical).
 * Throws InboxNotFoundError when the folder doesn't exist.
 *
 * Note: returns paths regardless of whether they are valid instruction sets —
 * schema validation is the orchestrator's responsibility (T4.5).
 */
export async function resolveBatch(
	vault: VaultFS,
	inboxFolder: string,
): Promise<string[]> {
	if (!(await vault.exists(inboxFolder))) {
		throw new InboxNotFoundError(inboxFolder);
	}

	const children = await vault.list(inboxFolder);
	const jsonFiles = children
		.filter((p) => p.endsWith("_instructions.json"))
		.slice()
		.sort();

	return jsonFiles;
}

// ---------------------------------------------------------------------------
// computeRemaining
// ---------------------------------------------------------------------------

/**
 * Take the validated ResolvedSource[] and produce the merged execution list
 * (ActionRecord[]) plus the dependency graph for halt-on-dependency.
 *
 * - Files processed in alphabetical order by fileId.
 * - Within each file: canonical order (KIND_ORDER), then monotonic I## within each kind.
 * - Actions with applied: true are filtered out of the execution list.
 * - DependencyEdge built in-set only (same fileId); cross-set NOT supported in v0.1.
 */
export function computeRemaining(sources: readonly ResolvedSource[]): {
	records: readonly ActionRecord[];
	dependencies: readonly DependencyEdge[];
} {
	const sorted = [...sources].sort((a, b) => a.fileId.localeCompare(b.fileId));

	const records: ActionRecord[] = [];
	const dependencies: DependencyEdge[] = [];

	for (const source of sorted) {
		const fileRecords = buildFileRecords(source);
		records.push(...fileRecords);
		dependencies.push(...buildDependencies(source));
	}

	return { records, dependencies };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildFileRecords(source: ResolvedSource): ActionRecord[] {
	const remaining = source.instructionSet.actions.filter(
		(a) => a.applied !== true,
	);

	const byKind = new Map<ActionKind, Action[]>();
	for (const action of remaining) {
		const bucket = byKind.get(action.action) ?? [];
		bucket.push(action);
		byKind.set(action.action, bucket);
	}

	const ordered: ActionRecord[] = [];
	for (const kind of KIND_ORDER) {
		const bucket = byKind.get(kind);
		if (!bucket) continue;
		const sorted = bucket.slice().sort((a, b) => compareId(a.id, b.id));
		for (const action of sorted) {
			ordered.push({
				fileId: source.fileId,
				id: action.id,
				kind,
				summary: buildSummary(action),
				outcome: null,
			});
		}
	}

	return ordered;
}

function buildDependencies(source: ResolvedSource): DependencyEdge[] {
	const actions = source.instructionSet.actions;

	const createMocs = actions.filter(
		(a): a is CreateMocAction => a.action === "create_moc",
	);
	const linkToMocs = actions.filter(
		(a): a is LinkToMocAction => a.action === "link_to_moc",
	);
	const addRelationships = actions.filter(
		(a): a is AddRelationshipAction => a.action === "add_relationship",
	);

	const edges: DependencyEdge[] = [];

	for (const link of linkToMocs) {
		const resolvedTarget = link.target_moc_path ?? link.target_moc;
		for (const create of createMocs) {
			if (create.destination === resolvedTarget) {
				edges.push({ dependent: link.id, dependsOn: create.id });
			}
		}
	}

	// F-43 collision-guard cascade: an add_relationship targeting a MOC
	// whose create_moc fails must also fail (no phantom up::/related:: edges
	// pointing into a non-existent MOC). target_moc_path is the canonical
	// resolved field; target_moc is informational only.
	for (const rel of addRelationships) {
		for (const create of createMocs) {
			if (create.destination === rel.target_moc_path) {
				edges.push({ dependent: rel.id, dependsOn: create.id });
			}
		}
	}

	return edges;
}

/** Compare two I## identifiers numerically (I01 < I02 < I10). */
function compareId(a: string, b: string): number {
	const numA = parseInt(a.replace(/^I/, ""), 10);
	const numB = parseInt(b.replace(/^I/, ""), 10);
	if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
	return a.localeCompare(b);
}

// `summary` is persisted verbatim into the run-log markdown table. Per
// Constitution L2 Privacy, audit traces must record metadata only — never
// the content of an inserted line, a tracker value, or other note bytes.
// Only path/structural fields belong here. (Review H1.)
function buildSummary(action: Action): string {
	switch (action.action) {
		case "create_moc":
			return `${action.source} → ${action.destination}`;
		case "move_note":
			return `${action.source} → ${action.destination}`;
		case "link_to_moc":
			return `${action.target_moc}`;
		case "insert_under_marker":
			return `${action.target_path}#${action.anchor.value ?? "—"} (${action.placement})`;
		case "add_relationship":
			return `${action.target_moc_path} :: ${action.marker}`;
		case "update_tracker":
			return `${action.daily_note_path} :: ${action.field}`;
		case "update_log_entry":
			return `${action.daily_note_path}#${action.section} (${action.position})`;
		case "update_log_link":
			return `${action.daily_note_path}#${action.section} ← [[${action.target_stem}]]`;
		case "delete_source":
			return `${action.source_path}`;
		case "skip":
			return action.source_path ?? "—";
	}
}
