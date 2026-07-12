import { globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.js", "manifest.json"],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...tseslint.configs.recommendedTypeChecked,
	{
		plugins: { obsidianmd },
		rules: {
			// obsidianmd 0.3.0's configs.recommended is a flat-config ARRAY of
			// blocks (js, tseslint, import, sdl, and the obsidianmd rules spread
			// across them) — not an object keyed by rule name. Treating it as an
			// object yielded zero rules, silently disabling the whole obsidianmd
			// ruleset. Flatten every block's `rules` and keep only the
			// obsidianmd/* keys, so we get the plugin's rules without adopting its
			// bundled js/tseslint/import presets (we configure those ourselves).
			...Object.fromEntries(
				(obsidianmd.configs!.recommended as Array<{ rules?: Record<string, unknown> }>)
					.flatMap((block) => Object.entries(block.rules ?? {}))
					.filter(([k]) => k.startsWith("obsidianmd/")),
			),
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
			"@typescript-eslint/require-await": "off",
			// Domain/proper-noun terms the sentence-case rule must leave alone:
			// "MOC" (Map of Content) is MiYo terminology; "Bridge" is part of the
			// "IDE Bridge" feature name whose Notice strings PRD F13 mandates
			// verbatim (see registerCommands.ts). ignoreWords keeps the plugin's
			// built-in acronym list (IDE, URL, …) intact, unlike overriding
			// `acronyms`.
			"obsidianmd/ui/sentence-case": ["error", { ignoreWords: ["MOC", "Bridge"] }],
		},
	},
	{
		files: ["manifest.json"],
		rules: {
			"obsidianmd/validate-manifest": "error",
			"@typescript-eslint/no-unused-expressions": "off",
			"no-unused-expressions": "off",
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"build",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"vitest.config.ts",
		"vitest.live.config.ts",
		"main.js",
		"test/__mocks__/**",
		"test/**/*.test.ts",
		"test/**/helpers.ts",
		"test/*/.obsidian/**",
		"test/fixtures/**",
		"claude-docker-home/**",
	]),
);
