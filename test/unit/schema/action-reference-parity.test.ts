/**
 * docs/action-reference.md ↔ vendored schema parity.
 *
 * `action-reference.md` is the document Tomo users and anyone hand-authoring an
 * instruction set read to learn the wire. When it names a field the schema does
 * not have, the reader writes an action that cannot validate — and the ajv
 * message they get back is famously unhelpful, since a `oneOf` matching no
 * branch reports OTHER kinds' required fields.
 *
 * That is not hypothetical: the incident that produced `edit_frontmatter` began
 * with a hand-authored set, and a 2026-09-01 audit found SIX of sixteen kinds
 * documented with phantom field names — `add_relationship` described as a
 * frontmatter operation it has never performed, `delete_source` with `path`
 * instead of `source_path`, and four more.
 *
 * So this is a drift guard on prose, checked the only way prose can be: against
 * the executable artifact. It deliberately checks one direction only —
 * documented fields must EXIST — rather than requiring every schema field to be
 * documented, since optional display-only fields may reasonably be omitted from
 * a user-facing reference.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import schema from "../../../src/schema/instructions.schema.json" with { type: "json" };

type SchemaDef = {
	readonly properties?: Record<string, unknown>;
};

const REFERENCE = readFileSync("docs/action-reference.md", "utf-8");

/** Every `$defs` entry that is an action kind, keyed by its `action` const. */
function actionKinds(): Map<string, ReadonlySet<string>> {
	const defs = (schema as { $defs: Record<string, SchemaDef> }).$defs;
	const out = new Map<string, ReadonlySet<string>>();
	for (const [name, def] of Object.entries(defs)) {
		const props = def.properties;
		if (props === undefined) continue;
		const action = (props["action"] as { const?: string } | undefined)?.const;
		if (action !== name) continue;
		out.set(name, new Set(Object.keys(props)));
	}
	return out;
}

/**
 * The `| \`field\` |` names in a kind's own section of the reference.
 *
 * Split rather than matched with a lookahead: an earlier version used
 * `(?=\n## |$)` with the `m` flag, where `$` means end-of-LINE, so the lazy
 * body match terminated immediately and every kind reported zero documented
 * fields. The suite went green while checking nothing — which is exactly the
 * failure this guard exists to catch, so it is worth not repeating in the guard
 * itself. `sectionBodies` is asserted non-empty below.
 */
function sectionBody(kind: string): string | null {
	const marker = `\n## \`${kind}\`\n`;
	const start = REFERENCE.indexOf(marker);
	if (start === -1) return null;
	const from = start + marker.length;
	const next = REFERENCE.indexOf("\n## ", from);
	return REFERENCE.slice(from, next === -1 ? undefined : next);
}

function documentedFields(kind: string): string[] {
	const body = sectionBody(kind);
	if (body === null) return [];
	return [...body.matchAll(/^\| `([a-z_]+)`/gm)].map((m) => m[1] ?? "");
}

describe("action-reference.md ↔ schema field parity", () => {
	const kinds = actionKinds();

	it("documents every action kind the schema defines", () => {
		expect([...kinds.keys()].filter((kind) => sectionBody(kind) === null)).toEqual([]);
	});

	it("actually reads field rows — guard against a vacuous pass", () => {
		// If the section matcher breaks again, every kind reports zero fields and
		// the parity check below passes while testing nothing.
		const withRows = [...kinds.keys()].filter((k) => documentedFields(k).length > 0);
		expect(withRows.length).toBeGreaterThan(kinds.size / 2);
	});

	it.each([...kinds.keys()])("%s names only fields the schema has", (kind) => {
		const real = kinds.get(kind) ?? new Set<string>();
		const phantom = documentedFields(kind).filter((f) => !real.has(f));
		expect(phantom).toEqual([]);
	});
});
