/**
 * Dead-link context extractor (spec-005 Phase 6, T6.1; SDD ADR-4) — reads the
 * affected note's body via `VaultFS.cachedRead` and extracts the occurrence
 * line(s) of a dead `[[wikilink]]` target, each with its nearest preceding
 * markdown heading, so the dead_link card can show the relationship inline
 * without a hover-preview (PRD F3 AC).
 *
 * Reads `cachedRead` content ONLY — never `vault.metadata()`/metadataCache,
 * which has a known async-rebuild race during multi-read batches (SDD
 * Implementation Gotchas; docs/ai/memory/troubleshooting.md
 * `metadatacache_rebuild_race`). Literal (non-regex) search for
 * `[[deadTarget]]` — Tomo's parser builds `match = "[[dead_target]]"`
 * verbatim, so this mirrors that exactly rather than re-deriving a wikilink
 * regex; a `deadTarget` containing regex-special characters (e.g. `A (1)`)
 * is searched via `String.includes`, which never interprets them.
 *
 * Cache: `createDeadLinkContextExtractor` returns one extractor instance
 * meant to live for a single DOC LOAD (rebuilt in `GardenAuditEditorView`'s
 * `loadAndRender()` on every open/retarget/Revert, not per-render within one
 * load — see that file's class-doc item 4), keyed per note PATH — the cache
 * stores the `cachedRead` PROMISE (not the final per-`deadTarget` result), so
 * concurrent/repeated `extract()` calls for the same note — even for
 * different dead targets within that note — coalesce into a single vault
 * read. A rejected read (missing/moved note) is cached too, as `null`, so a
 * repeatedly-broken link doesn't re-attempt the read on every card render
 * within the same doc load (see `readCached` below for the retry-point note).
 */

import type { VaultFS } from "../vault/VaultFS.js";

const MAX_SNIPPET_LENGTH = 200;

export interface DeadLinkOccurrence {
	readonly line: string;
	readonly heading: string | null;
}

export type DeadLinkContextResult =
	| { readonly status: "ok"; readonly occurrences: readonly DeadLinkOccurrence[] }
	| { readonly status: "note-not-found" };

export interface DeadLinkContextExtractor {
	extract(notePath: string, deadTarget: string): Promise<DeadLinkContextResult>;
}

/** Trims a snippet and caps it at `MAX_SNIPPET_LENGTH`, so one huge line can't blow up the card. */
function capSnippet(line: string): string {
	const trimmed = line.trim();
	if (trimmed.length <= MAX_SNIPPET_LENGTH) return trimmed;
	return `${trimmed.slice(0, MAX_SNIPPET_LENGTH)}…`;
}

/** Strips a leading ATX heading marker (`#` through `######`) for a clean display label. */
function stripHeadingMarker(line: string): string {
	return line.replace(/^#{1,6}\s*/, "");
}

function extractOccurrences(content: string, deadTarget: string): DeadLinkOccurrence[] {
	const needle = `[[${deadTarget}]]`;
	const occurrences: DeadLinkOccurrence[] = [];
	let heading: string | null = null;

	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (line.startsWith("#")) {
			heading = stripHeadingMarker(line);
		}
		// Literal substring search — `deadTarget` is untrusted note content,
		// never treated as a regex pattern (see file header).
		if (line.includes(needle)) {
			occurrences.push({ line: capSnippet(line), heading });
		}
	}
	return occurrences;
}

export function createDeadLinkContextExtractor(fs: VaultFS): DeadLinkContextExtractor {
	// Caches the cachedRead outcome per note path — `null` marks a read that
	// failed (missing/moved note). Deliberately NOT keyed by `deadTarget`:
	// occurrence extraction from the cached content is cheap and pure, so two
	// dead links in the same note share one vault read.
	const contentCache = new Map<string, Promise<string | null>>();

	function readCached(notePath: string): Promise<string | null> {
		const cached = contentCache.get(notePath);
		if (cached !== undefined) return cached;

		// A failed read is negative-cached (as `null`) for this extractor
		// instance's lifetime — no retry-on-next-render. Since the view now
		// recreates the extractor per doc-load (GardenAuditEditorView T6.1),
		// that lifetime is "until the next doc load / Revert", which is the
		// acceptable retry point.
		const pending = fs.cachedRead(notePath).catch(() => null);
		contentCache.set(notePath, pending);
		return pending;
	}

	return {
		async extract(notePath: string, deadTarget: string): Promise<DeadLinkContextResult> {
			const content = await readCached(notePath);
			if (content === null) return { status: "note-not-found" };
			return { status: "ok", occurrences: extractOccurrences(content, deadTarget) };
		},
	};
}
