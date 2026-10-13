/**
 * The rename-target sanitiser (#141). Its contract is Tomo's Pass-2 refusal
 * list for a typed name (QA handoff 2026-10-13 §1.1): whatever this returns,
 * when non-blank, must never be refused there. Owner ruling: forbidden
 * characters become "-" (visibly), they are not removed.
 */

import { describe, expect, it } from "vitest";

import { basenameOf, dirnameOf, sanitiseAttachmentName } from "../../../src/suggestions/attachmentName.js";

describe("sanitiseAttachmentName", () => {
	it("leaves a legal name untouched and says so", () => {
		expect(sanitiseAttachmentName("karte (2).png")).toEqual({ cleaned: "karte (2).png", changed: false });
	});

	it("turns Tomo's QA case H2 into the name their expected table lists", () => {
		expect(sanitiseAttachmentName("goerlitz [luftbild].png").cleaned).toBe("goerlitz -luftbild-.png");
	});

	it.each([
		["filesystem-forbidden", 'a\\b/c:d*e?f"g<h>i|j.png', "a-b-c-d-e-f-g-h-i-j.png"],
		["link-breaking", "karte#19^2[x].png", "karte-19-2-x-.png"],
		["template sequences", "{{date}} <%tp%>.png", "-date}} -%tp%-.png"],
		["control characters", "a\u0000b\u001fc\u007fd.png", "a-b-c-d.png"],
	])("replaces %s characters with '-'", (_label, raw, cleaned) => {
		expect(sanitiseAttachmentName(raw)).toEqual({ cleaned, changed: true });
	});

	it("trims edge whitespace (Tomo refuses it, never trims) and reports the change", () => {
		expect(sanitiseAttachmentName("  karte.png \t")).toEqual({ cleaned: "karte.png", changed: true });
	});

	it("returns blank for whitespace-only input — the caller refuses it inline", () => {
		expect(sanitiseAttachmentName("   ").cleaned).toBe("");
	});
});

describe("basenameOf / dirnameOf", () => {
	it("split a vault path at the last separator", () => {
		expect(basenameOf("100 Inbox/Scans/karte.png")).toBe("karte.png");
		expect(dirnameOf("100 Inbox/Scans/karte.png")).toBe("100 Inbox/Scans");
	});

	it("treat a root-level path as having an empty folder", () => {
		expect(basenameOf("karte.png")).toBe("karte.png");
		expect(dirnameOf("karte.png")).toBe("");
	});
});
