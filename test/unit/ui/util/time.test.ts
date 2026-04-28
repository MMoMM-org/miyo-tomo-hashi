import { describe, expect, it } from "vitest";

import { formatUptime } from "../../../../src/ui/util/time";

describe("formatUptime", () => {
	const now = new Date("2026-04-28T12:00:00Z");
	const at = (deltaSeconds: number): Date =>
		new Date(now.getTime() - deltaSeconds * 1000);

	it("0 seconds → '0 sec ago'", () => {
		expect(formatUptime(at(0), now)).toBe("0 sec ago");
	});

	it("59 seconds → '59 sec ago'", () => {
		expect(formatUptime(at(59), now)).toBe("59 sec ago");
	});

	it("60 seconds → '1 min ago'", () => {
		expect(formatUptime(at(60), now)).toBe("1 min ago");
	});

	it("3599 seconds → '59 min ago'", () => {
		expect(formatUptime(at(3599), now)).toBe("59 min ago");
	});

	it("3600 seconds → '1 hr ago'", () => {
		expect(formatUptime(at(3600), now)).toBe("1 hr ago");
	});

	it("23 hours, 59 minutes → '23 hr ago'", () => {
		expect(formatUptime(at(23 * 3600 + 59 * 60), now)).toBe("23 hr ago");
	});

	it("24 hours → '1 d ago'", () => {
		expect(formatUptime(at(24 * 3600), now)).toBe("1 d ago");
	});

	it("future timestamp clamps to '0 sec ago' (no negative seconds)", () => {
		const future = new Date(now.getTime() + 5000);
		expect(formatUptime(future, now)).toBe("0 sec ago");
	});
});
