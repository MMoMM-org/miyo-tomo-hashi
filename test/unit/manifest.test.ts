import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("manifest.json", () => {
	it("must declare isDesktopOnly: true (Hashi v0.1 platform constraint, SDD CON-1)", () => {
		const manifestPath = resolve(__dirname, "../../manifest.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
			isDesktopOnly: boolean;
		};
		expect(manifest.isDesktopOnly).toBe(true);
	});
});
