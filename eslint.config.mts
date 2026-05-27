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
			// obsidianmd 0.3.0's configs.recommended is a hybrid object: iterating
			// it yields a full flat-config array (with js, tseslint, import, sdl
			// bundled in), but its own properties are the obsidianmd/* rules. We
			// only want the rules — extract them by filtering on the prefix.
			...Object.fromEntries(
				Object.entries(obsidianmd.configs!.recommended as Record<string, unknown>)
					.filter(([k]) => k.startsWith("obsidianmd/")),
			),
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
			"@typescript-eslint/require-await": "off",
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
