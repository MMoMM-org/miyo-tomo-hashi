import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		// Production connection code uses window.* timers (Electron globals); the
		// node env has no window, so shim it to globalThis. See the setup file.
		setupFiles: ["./test/live/_helpers/setup-window-shim.ts"],
		include: ["test/live/**/*.test.ts"],
		testTimeout: 90_000,
		hookTimeout: 30_000,
	},
});
