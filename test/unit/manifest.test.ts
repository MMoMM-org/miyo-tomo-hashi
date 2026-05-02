import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface Manifest {
	id: string;
	name: string;
	description: string;
	author: string;
	authorUrl: string;
	isDesktopOnly: boolean;
	fundingUrl?: Record<string, string> | string;
}

function loadManifest(): Manifest {
	const manifestPath = resolve(__dirname, "../../manifest.json");
	return JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
}

describe("manifest.json — platform constraints", () => {
	it("must declare isDesktopOnly: true (Hashi v0.1 platform constraint, SDD CON-1)", () => {
		expect(loadManifest().isDesktopOnly).toBe(true);
	});
});

describe("manifest.json — version (M15)", () => {
	interface ManifestWithVersion extends Manifest {
		version: string;
	}

	function loadVersionedManifest(): ManifestWithVersion {
		return loadManifest() as ManifestWithVersion;
	}

	it("declares a non-zero semver matching package.json (M15)", () => {
		const m = loadVersionedManifest();
		// Pre-fix: 0.0.0 — pre-release placeholder. PRD targets v0.1.0
		// as the first published version. Must be a valid semver and
		// match package.json so Obsidian's plugin manager can install
		// and update consistently.
		expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(m.version).not.toBe("0.0.0");

		const pkgPath = resolve(__dirname, "../../package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
			version: string;
		};
		expect(m.version).toBe(pkg.version);
	});
});

describe("manifest.json — Obsidian community-plugin review constraints", () => {
	// All four assertions below mirror the rejection points the Obsidian
	// reviewer bot raised on the sibling plugin obsidian-archivist (PR
	// obsidian-releases#12370). Locking them in tests so a future manifest
	// edit can't silently regress us out of publishability.

	it("id does NOT contain 'obsidian' (reviewer rule, archivist#28 fix)", () => {
		const id = loadManifest().id.toLowerCase();
		expect(id).not.toMatch(/obsidian/);
	});

	it("name does NOT start with 'Obsidian' (reviewer rule, archivist#28 fix)", () => {
		expect(loadManifest().name.toLowerCase()).not.toMatch(/^obsidian/);
	});

	it("description does NOT mention 'Obsidian' (the store context already implies it)", () => {
		expect(loadManifest().description.toLowerCase()).not.toMatch(/obsidian/);
	});

	it("authorUrl points at the author, NOT the plugin repository", () => {
		// Reviewer rule from archivist#28: authorUrl must point at the author,
		// not the plugin/repo. github.com/MMoMM-org/<repo-name> is what
		// triggered the rejection there.
		const authorUrl = loadManifest().authorUrl;
		expect(authorUrl).not.toMatch(/github\.com\/MMoMM-org\/miyo-tomo-hashi/);
		expect(authorUrl).toMatch(/^https:\/\//);
	});
});
