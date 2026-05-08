/**
 * HeaderSection — verifies the hanko ships inlined (no runtime asset
 * resolution required), so installs via BRAT or manual zip — neither of
 * which extract the `assets/` directory — still render the seal, and the
 * identity line is fully manifest-driven.
 *
 * Mirrors miyo-kado/test/settings/HeaderSection.test.ts. Hashi's obsidian
 * mock augments HTMLElement.prototype globally, so plain DOM elements
 * already expose Obsidian's createDiv/createEl/createSpan helpers — no
 * augmentEl import is needed.
 */

import { describe, it, expect } from "vitest";
import type { PluginManifest } from "obsidian";

// Side-effect import to install the obsidian mock's HTMLElement.prototype
// shim (createDiv / createEl / createSpan). Type-only imports are erased
// before module resolution, so the mock would not load otherwise.
import "obsidian";

import { HeaderSection } from "../../../src/settings/HeaderSection";

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
	return {
		id: "miyo-tomo-hashi",
		name: "MiYo Tomo Hashi",
		version: "0.0.0-test",
		minAppVersion: "1.5.0",
		description: "test",
		author: "Marcus Breiden <marcus@mmomm.org>",
		authorUrl: "https://www.mmomm.org",
		...overrides,
	} as PluginManifest;
}

describe("HeaderSection", () => {
	it("renders the hanko image without a runtime asset resolver", () => {
		const section = new HeaderSection({ plugin: { manifest: makeManifest() } });
		const container = document.createElement("div");

		section.render(container);

		const img = container.querySelector<HTMLImageElement>("img.hashi-header-hanko");
		expect(img).not.toBeNull();
		expect(img?.getAttribute("src") ?? "").not.toBe("");
		expect(img?.getAttribute("alt")).toBe("MiYo Tomo Hashi hanko");
	});

	it("renders the manifest-driven identity line", () => {
		const section = new HeaderSection({
			plugin: { manifest: makeManifest({ version: "1.2.3" }) },
		});
		const container = document.createElement("div");

		section.render(container);

		const text = container.textContent ?? "";
		expect(text).toContain("MiYo Tomo Hashi v1.2.3");
		expect(text).toContain("Marcus Breiden");
		expect(text).toContain("Documentation");
	});

	it("renders the author as a link when authorUrl is present", () => {
		const section = new HeaderSection({ plugin: { manifest: makeManifest() } });
		const container = document.createElement("div");

		section.render(container);

		const links = container.querySelectorAll<HTMLAnchorElement>("a");
		const authorLink = Array.from(links).find(a => a.textContent === "Marcus Breiden");
		expect(authorLink).toBeDefined();
		expect(authorLink?.getAttribute("href")).toBe("https://www.mmomm.org");
	});

	it("renders the author as plain text when authorUrl is absent", () => {
		const section = new HeaderSection({
			plugin: { manifest: makeManifest({ authorUrl: undefined }) },
		});
		const container = document.createElement("div");

		section.render(container);

		const links = container.querySelectorAll<HTMLAnchorElement>("a");
		const authorLink = Array.from(links).find(a => a.textContent === "Marcus Breiden");
		expect(authorLink).toBeUndefined();
		// Author name still appears in the identity-line text content.
		expect(container.textContent ?? "").toContain("Marcus Breiden");
	});

	it("renders the curated tagline (not manifest.description)", () => {
		const section = new HeaderSection({
			plugin: {
				manifest: makeManifest({ description: "different copy from the manifest" }),
			},
		});
		const container = document.createElement("div");

		section.render(container);

		const tagline = container.querySelector<HTMLParagraphElement>("p.hashi-tagline");
		expect(tagline).not.toBeNull();
		expect(tagline?.textContent ?? "").not.toBe("different copy from the manifest");
		expect((tagline?.textContent ?? "").length).toBeGreaterThan(0);
	});
});
