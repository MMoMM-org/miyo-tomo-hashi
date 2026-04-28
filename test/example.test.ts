import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/types/index";

describe("Plugin Settings", () => {
	it("should have default values", () => {
		expect(DEFAULT_SETTINGS).toBeDefined();
		expect(DEFAULT_SETTINGS.chosenInstanceName).toBeNull();
	});
});
