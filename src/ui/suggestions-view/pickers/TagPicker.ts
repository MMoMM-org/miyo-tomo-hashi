/**
 * Tag fuzzy picker (SDD §7, PRD F6). Items come from
 * `metadataCache.getTags()` — an undocumented Obsidian API named explicitly
 * by the SDD ("Fuzzy pickers ... tags (`metadataCache.getTags()`)") but
 * absent from both `obsidian.d.ts` and `test/__mocks__/obsidian.ts`. Rather
 * than widen the shared `App`/`MetadataCache` types (or edit the mock) for
 * one undocumented method, it is narrowly typed and cast here; tests attach
 * `getTags` directly to the mock's `metadataCache` object per-test.
 */

import type { App } from "obsidian";

import { FuzzyFieldPicker } from "./FuzzyFieldPicker.js";

interface MetadataCacheWithTags {
	getTags(): Record<string, number>;
}

export class TagPicker extends FuzzyFieldPicker {
	constructor(
		app: App,
		onChoose: (tag: string) => void,
		private readonly limitPrefixes: readonly string[] = [],
	) {
		super(app, onChoose, "Choose a tag…");
	}

	getItems(): string[] {
		const cache = this.app.metadataCache as unknown as MetadataCacheWithTags;
		const tags = Object.keys(cache.getTags());
		if (this.limitPrefixes.length === 0) return tags;
		return tags.filter((tag) => this.limitPrefixes.some((prefix) => matchesPrefix(tag, prefix)));
	}
}

/**
 * Namespace prefix match: `topic/` (or `topic`) keeps `topic` and
 * `topic/people` but not `topical`. `metadataCache.getTags()` keys carry a
 * leading `#`, which the configured prefixes generally won't, so both sides
 * are compared with the `#` stripped.
 */
function matchesPrefix(tag: string, prefix: string): boolean {
	const t = tag.replace(/^#/, "");
	const p = prefix.replace(/^#/, "");
	if (p === "") return true;
	return t === p || t.startsWith(p.endsWith("/") ? p : `${p}/`);
}
