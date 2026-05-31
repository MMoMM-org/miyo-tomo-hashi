import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			obsidian: path.resolve(__dirname, "test/__mocks__/obsidian.ts"),
			// @codemirror/view is an Obsidian-provided external (esbuild externals);
			// stub it under vitest so importing main.ts doesn't pull the real,
			// browser-oriented CM6 view module into jsdom. See the mock header.
			"@codemirror/view": path.resolve(
				__dirname,
				"test/__mocks__/codemirror-view.ts",
			),
		},
	},
	test: {
		globals: true,
		environment: "jsdom",
		include: ["test/**/*.test.ts"],
		exclude: ["test/live/**"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.d.ts"],
		},
	},
});
