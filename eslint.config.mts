import { globalIgnores } from "eslint/config";
import type { Linter } from "eslint";
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
		rules: obsidianmd.configs!.recommended as Linter.RulesRecord,
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
