import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["test/live/**/*.test.ts"],
		testTimeout: 90_000,
		hookTimeout: 30_000,
	},
});
