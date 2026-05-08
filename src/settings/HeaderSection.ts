/**
 * HeaderSection — manifest-driven identity strip rendered above the existing
 * settings sections in SettingsTab.
 *
 * Why this file exists: surfaces plugin identity (name, version, author,
 * documentation link) sourced from manifest.json plus the Tomo Hashi hanko
 * (印, the seal) as a visual anchor on the right. Manifest-driven so any
 * change to plugin metadata propagates automatically.
 *
 * Layout (two-column flex; styles in styles.css):
 *
 *   ┌─ .hashi-header-text (flex 1) ───────────────────┐  ┌─ .hashi-header-hanko ─┐
 *   │ .hashi-header-identity                           │  │   <img 72x72>         │
 *   │   Name vX.Y.Z · Author · Documentation           │  │                       │
 *   │ .hashi-tagline                                   │  │                       │
 *   │   <curated identity copy>                        │  │                       │
 *   └──────────────────────────────────────────────────┘  └───────────────────────┘
 *
 * Tagline: hardcoded `TAGLINE` constant, deliberately independent from
 * `manifest.description`. The manifest description is the prose blurb
 * Obsidian shows in its Community Plugins listing (longer, search-friendly);
 * the in-plugin tagline is identity copy for users who already installed
 * the plugin.
 *
 * Hanko delivery: imported as a build-time data URI via esbuild's `dataurl`
 * loader. The 144×144 derivative (~30 KB) is HiDPI-crisp at the rendered
 * 72×72 — see scripts/build-hanko-144.py for the resize/transparency
 * pipeline. Inlining is the only delivery path that survives both the
 * official Community Plugins installer and BRAT, which fetch only
 * main.js / manifest.json / styles.css from a release.
 *
 * Funding links: NOT rendered here. Obsidian's Community Plugins UI
 * surfaces `manifest.fundingUrl` automatically on the listing page;
 * duplicating it inside settings is noise.
 *
 * Mirrors miyo-kado/src/settings/HeaderSection.ts as the canonical MiYo
 * Obsidian-plugin settings header (handoff `2026-05-08_kado-to-hashi_
 * unified-obsidian-settings-header.md`).
 */

import type { PluginManifest } from "obsidian";

import hankoImageUrl from "../../assets/tomo-hashi-hanko-144.png";

interface HeaderSectionDeps {
	plugin: { manifest: PluginManifest };
}

/** Hardcoded GitHub repository URL — used as the Documentation link. */
const REPO_URL = "https://github.com/MMoMM-org/miyo-tomo-hashi";

/**
 * In-plugin header tagline. Curated identity copy — three verbs covering
 * Hashi's user-facing surface (Session View chat, instruction-set preview,
 * executor apply). Independent of manifest.description.
 */
const TAGLINE = "Bridge to your Tomo session — chat, review, run.";

/**
 * Parses the human-readable author display name from Obsidian's author string.
 * Obsidian convention: "Full Name <email@example.com>" — we take the part
 * before the angle bracket and trim whitespace. Falls back to the full string
 * if no angle bracket is present.
 */
function parseAuthorDisplayName(author: string): string {
	const angleIdx = author.indexOf("<");
	if (angleIdx === -1) return author.trim();
	return author.slice(0, angleIdx).trim();
}

export class HeaderSection {
	private readonly plugin: { manifest: PluginManifest };

	constructor(deps: HeaderSectionDeps) {
		this.plugin = deps.plugin;
	}

	/**
	 * Populates a container with the plugin header.
	 *
	 * @param containerEl — target element to render into; SettingsTab supplies
	 *   the `.hashi-settings-header` wrapper so the header lands in the
	 *   correct layout slot.
	 */
	render(containerEl: HTMLElement): void {
		const { manifest } = this.plugin;
		const manifestWithUrl = manifest as PluginManifest & { authorUrl?: string };

		// Left column: text identity
		const textCol = containerEl.createDiv({ cls: "hashi-header-text" });

		// Identity line: name vX.Y.Z · Author · Documentation
		const identity = textCol.createDiv({ cls: "hashi-header-identity" });

		identity.createSpan({ text: manifest.name, cls: "hashi-plugin-name" });
		identity.createSpan({ text: ` v${manifest.version}` });

		const authorName = parseAuthorDisplayName(manifest.author ?? "");
		identity.createSpan({ text: " · ", cls: "hashi-header-sep" });
		if (manifestWithUrl.authorUrl !== undefined) {
			identity.createEl("a", {
				text: authorName,
				attr: { href: manifestWithUrl.authorUrl },
			});
		} else {
			identity.createSpan({ text: authorName });
		}

		identity.createSpan({ text: " · ", cls: "hashi-header-sep" });
		identity.createEl("a", { text: "Documentation", attr: { href: REPO_URL } });

		// Tagline (curated, manifest-independent)
		textCol.createEl("p", { text: TAGLINE, cls: "hashi-tagline" });

		// Right column: hanko image (build-time inlined data URI)
		containerEl.createEl("img", {
			cls: "hashi-header-hanko",
			attr: {
				src: hankoImageUrl,
				alt: `${manifest.name} hanko`,
			},
		});
	}
}
