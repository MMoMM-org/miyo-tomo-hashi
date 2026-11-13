import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #28 (H25) — PRD-001 F3/AC8, F5/AC6, F9/AC5: motion degrades to static under
 * `prefers-reduced-motion: reduce`.
 *
 * The behaviour is pure CSS (no code reads `matchMedia`), and jsdom does not
 * apply media queries, so a matchMedia mock would assert nothing. Instead this
 * reads `styles.css` and requires every rule that declares a transition or
 * animation to be reset inside a reduced-motion block — which also catches a
 * future transition added without one. The OS toggle itself stays a manual-QA
 * check (manual-qa-checklist.md row 17).
 */

interface CssRule {
	selector: string;
	body: string;
	media: string | null;
}

const REDUCED_MOTION = /prefers-reduced-motion:\s*reduce/;
const MOTION_DECL = /(?:^|;)\s*(transition|animation)(?:-[a-z-]+)?\s*:\s*([^;]+)/g;

function parseRules(css: string): CssRule[] {
	const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const rules: CssRule[] = [];
	let media: string | null = null;
	let depth = 0;
	let start = 0;
	let selector = "";
	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (ch === "{") {
			const head = src.slice(start, i).trim();
			if (head.startsWith("@media")) media = head;
			else selector = head;
			depth++;
			start = i + 1;
		} else if (ch === "}") {
			if (selector) {
				rules.push({ selector, body: src.slice(start, i).trim(), media });
				selector = "";
			} else if (depth === 1) {
				media = null;
			}
			depth--;
			start = i + 1;
		}
	}
	return rules;
}

function motionProps(body: string): Map<string, string> {
	const props = new Map<string, string>();
	for (const m of body.matchAll(MOTION_DECL)) props.set(m[1]!, m[2]!.trim());
	return props;
}

const rules = parseRules(readFileSync(resolve(__dirname, "../../styles.css"), "utf-8"));

describe("styles.css — prefers-reduced-motion", () => {
	const moving = rules.filter(
		(r) =>
			!(r.media && REDUCED_MOTION.test(r.media)) &&
			[...motionProps(r.body).values()].some((v) => v !== "none"),
	);
	const resets = rules.filter((r) => r.media && REDUCED_MOTION.test(r.media));

	it("finds the motion it is guarding (the parser is not vacuous)", () => {
		expect(moving.map((r) => r.selector)).toContain(".hashi-status-bar-glyph");
	});

	it("resets every transition and animation to none under reduced motion", () => {
		const unreset = moving.flatMap((r) =>
			[...motionProps(r.body).keys()]
				.filter(
					(prop) =>
						!resets.some(
							(reset) =>
								reset.selector === r.selector &&
								motionProps(reset.body).get(prop) === "none",
						),
				)
				.map((prop) => `${r.selector} { ${prop} }`),
		);
		expect(unreset).toEqual([]);
	});
});
