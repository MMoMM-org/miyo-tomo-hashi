/**
 * Unit tests for the dead-link context extractor (spec-005 Phase 6, T6.1;
 * SDD ADR-4) — occurrence + nearest-heading extraction over `cachedRead`
 * content, missing-note degrade, and the per-note-path read cache.
 */

import { describe, expect, it, vi } from "vitest";

import { createDeadLinkContextExtractor } from "../../../src/garden-audit/deadLinkContext";
import { FakeVaultFS } from "../../../src/vault/FakeVaultFS";

const NOTE_PATH = "MOCs/020 Active MOC.md";

describe("createDeadLinkContextExtractor — single occurrence", () => {
	it("returns the occurrence line and its nearest preceding heading", async () => {
		const fs = new FakeVaultFS();
		await fs.create(
			NOTE_PATH,
			["# Active MOC", "", "## Sparks", "", "- see [[023 Sparks MOC]] for background."].join(
				"\n",
			),
		);
		const extractor = createDeadLinkContextExtractor(fs);

		const result = await extractor.extract(NOTE_PATH, "023 Sparks MOC");

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.occurrences).toEqual([
			{ line: "- see [[023 Sparks MOC]] for background.", heading: "Sparks" },
		]);
	});

	it("returns heading: null when no heading precedes the occurrence", async () => {
		const fs = new FakeVaultFS();
		await fs.create(NOTE_PATH, "- see [[023 Sparks MOC]] for background.");
		const extractor = createDeadLinkContextExtractor(fs);

		const result = await extractor.extract(NOTE_PATH, "023 Sparks MOC");

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.occurrences).toEqual([
			{ line: "- see [[023 Sparks MOC]] for background.", heading: null },
		]);
	});
});

describe("createDeadLinkContextExtractor — heading detection", () => {
	it("does not treat a #tag line as a heading", async () => {
		const fs = new FakeVaultFS();
		await fs.create(
			NOTE_PATH,
			["#project", "", "- see [[023 Sparks MOC]] for background."].join("\n"),
		);
		const extractor = createDeadLinkContextExtractor(fs);

		const result = await extractor.extract(NOTE_PATH, "023 Sparks MOC");

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.occurrences).toEqual([
			{ line: "- see [[023 Sparks MOC]] for background.", heading: null },
		]);
	});

	it("still treats a level-6 (######) heading as a heading", async () => {
		const fs = new FakeVaultFS();
		await fs.create(
			NOTE_PATH,
			["###### H6", "", "- see [[023 Sparks MOC]] for background."].join("\n"),
		);
		const extractor = createDeadLinkContextExtractor(fs);

		const result = await extractor.extract(NOTE_PATH, "023 Sparks MOC");

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.occurrences).toEqual([
			{ line: "- see [[023 Sparks MOC]] for background.", heading: "H6" },
		]);
	});
});

describe("createDeadLinkContextExtractor — multiple occurrences", () => {
	it("returns every occurrence in order, each with its own nearest heading", async () => {
		const fs = new FakeVaultFS();
		await fs.create(
			NOTE_PATH,
			[
				"## First",
				"- see [[023 Sparks MOC]] here",
				"## Second",
				"- and again [[023 Sparks MOC]] there",
			].join("\n"),
		);
		const extractor = createDeadLinkContextExtractor(fs);

		const result = await extractor.extract(NOTE_PATH, "023 Sparks MOC");

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.occurrences).toEqual([
			{ line: "- see [[023 Sparks MOC]] here", heading: "First" },
			{ line: "- and again [[023 Sparks MOC]] there", heading: "Second" },
		]);
	});
});

describe("createDeadLinkContextExtractor — missing note", () => {
	it("degrades to note-not-found instead of throwing", async () => {
		const fs = new FakeVaultFS();
		const extractor = createDeadLinkContextExtractor(fs);

		await expect(extractor.extract("Nope.md", "023 Sparks MOC")).resolves.toEqual({
			status: "note-not-found",
		});
	});
});

describe("createDeadLinkContextExtractor — per-note-path cache", () => {
	it("performs exactly one cachedRead for two extracts of the same path", async () => {
		const fs = new FakeVaultFS();
		await fs.create(NOTE_PATH, "- see [[023 Sparks MOC]] here");
		const spy = vi.spyOn(fs, "cachedRead");
		const extractor = createDeadLinkContextExtractor(fs);

		await extractor.extract(NOTE_PATH, "023 Sparks MOC");
		await extractor.extract(NOTE_PATH, "023 Sparks MOC");

		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("does not re-read even for a different dead_target on the same note path", async () => {
		const fs = new FakeVaultFS();
		await fs.create(
			NOTE_PATH,
			["- see [[023 Sparks MOC]] here", "- and [[030 Other MOC]] there"].join("\n"),
		);
		const spy = vi.spyOn(fs, "cachedRead");
		const extractor = createDeadLinkContextExtractor(fs);

		const first = await extractor.extract(NOTE_PATH, "023 Sparks MOC");
		const second = await extractor.extract(NOTE_PATH, "030 Other MOC");

		expect(spy).toHaveBeenCalledTimes(1);
		expect(first.status).toBe("ok");
		expect(second.status).toBe("ok");
		if (first.status === "ok") expect(first.occurrences).toHaveLength(1);
		if (second.status === "ok") expect(second.occurrences).toHaveLength(1);
	});

	it("performs a separate cachedRead for a different note path", async () => {
		const fs = new FakeVaultFS();
		await fs.create(NOTE_PATH, "- see [[023 Sparks MOC]] here");
		await fs.create("Other.md", "- see [[023 Sparks MOC]] here too");
		const spy = vi.spyOn(fs, "cachedRead");
		const extractor = createDeadLinkContextExtractor(fs);

		await extractor.extract(NOTE_PATH, "023 Sparks MOC");
		await extractor.extract("Other.md", "023 Sparks MOC");

		expect(spy).toHaveBeenCalledTimes(2);
	});
});

describe("createDeadLinkContextExtractor — async, non-blocking", () => {
	it("extract() returns a Promise and does not resolve synchronously", async () => {
		const fs = new FakeVaultFS();
		await fs.create(NOTE_PATH, "- see [[023 Sparks MOC]] here");
		const extractor = createDeadLinkContextExtractor(fs);

		let resolved = false;
		const pending = extractor.extract(NOTE_PATH, "023 Sparks MOC").then((r) => {
			resolved = true;
			return r;
		});

		expect(pending).toBeInstanceOf(Promise);
		expect(resolved).toBe(false);

		await pending;
		expect(resolved).toBe(true);
	});
});

describe("createDeadLinkContextExtractor — edge cases", () => {
	it("caps a very long occurrence line at 200 characters, appending an ellipsis", async () => {
		const fs = new FakeVaultFS();
		const filler = "x".repeat(250);
		await fs.create(NOTE_PATH, `${filler} [[023 Sparks MOC]]`);
		const extractor = createDeadLinkContextExtractor(fs);

		const result = await extractor.extract(NOTE_PATH, "023 Sparks MOC");

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		const [occurrence] = result.occurrences;
		expect(occurrence?.line.length).toBe(201); // 200 chars + "…"
		expect(occurrence?.line.endsWith("…")).toBe(true);
	});

	it("treats a dead_target containing regex-special characters literally", async () => {
		const fs = new FakeVaultFS();
		await fs.create(NOTE_PATH, "- link to [[A (1)]] over here");
		const extractor = createDeadLinkContextExtractor(fs);

		// "A (1)" would blow up as a regex (unbalanced/greedy group) if the
		// extractor ever compiled it into one — this must not throw and must
		// find the literal occurrence.
		const result = await extractor.extract(NOTE_PATH, "A (1)");

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.occurrences).toHaveLength(1);
		expect(result.occurrences[0]?.line).toContain("[[A (1)]]");
	});
});
