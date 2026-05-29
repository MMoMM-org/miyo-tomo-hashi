import { describe, expect, it } from "vitest";

import {
	decodeFrames,
	encodeClose,
	encodePing,
	encodePong,
	encodeText,
} from "../../../src/ide-bridge/frame";

/** Build a masked client→server frame by hand for a given opcode + payload. */
function maskedFrame(opcode: number, payload: Buffer, maskKey: Buffer): Buffer {
	const len = payload.length;
	let header: Buffer;
	if (len < 126) {
		header = Buffer.from([0x80 | opcode, 0x80 | len]);
	} else if (len <= 0xffff) {
		header = Buffer.alloc(4);
		header[0] = 0x80 | opcode;
		header[1] = 0x80 | 126;
		header.writeUInt16BE(len, 2);
	} else {
		header = Buffer.alloc(10);
		header[0] = 0x80 | opcode;
		header[1] = 0x80 | 127;
		header.writeBigUInt64BE(BigInt(len), 2);
	}
	const masked = Buffer.alloc(len);
	for (let i = 0; i < len; i++) {
		masked[i] = (payload[i] ?? 0) ^ (maskKey[i % 4] ?? 0);
	}
	return Buffer.concat([header, maskKey, masked]);
}

describe("frame codec — encode/decode round-trips", () => {
	it("encodeText produces an UNMASKED server frame that round-trips", () => {
		const buf = encodeText("hello world");
		// FIN+TEXT opcode, mask bit MUST be 0 on server frames.
		expect(buf[0]).toBe(0x81);
		expect((buf[1] as number) & 0x80).toBe(0);

		const { frames, rest } = decodeFrames(buf);
		expect(rest.length).toBe(0);
		expect(frames).toHaveLength(1);
		expect(frames[0]?.kind).toBe("text");
		expect(frames[0]?.payload).toBe("hello world");
	});

	it("decodes a MASKED client→server TEXT frame to the original payload", () => {
		const maskKey = Buffer.from([0x12, 0x34, 0x56, 0x78]);
		const frame = maskedFrame(0x1, Buffer.from("client says hi", "utf8"), maskKey);
		// mask bit set
		expect((frame[1] as number) & 0x80).toBe(0x80);

		const { frames, rest } = decodeFrames(frame);
		expect(rest.length).toBe(0);
		expect(frames[0]?.kind).toBe("text");
		expect(frames[0]?.payload).toBe("client says hi");
	});

	it("PING decodes and encodePong produces a valid PONG frame", () => {
		const pingPayload = Buffer.from("ka", "utf8");
		const ping = encodePing(pingPayload);
		const decodedPing = decodeFrames(ping);
		expect(decodedPing.frames[0]?.kind).toBe("ping");
		expect(decodedPing.frames[0]?.payload).toEqual(pingPayload);

		const pong = encodePong(pingPayload);
		expect(pong[0]).toBe(0x8a); // FIN + PONG opcode
		const decodedPong = decodeFrames(pong);
		expect(decodedPong.frames[0]?.kind).toBe("pong");
		expect(decodedPong.frames[0]?.payload).toEqual(pingPayload);
	});

	it("CLOSE frame is recognized and round-trips its 2-byte status code", () => {
		const close = encodeClose(1000);
		const { frames } = decodeFrames(close);
		expect(frames[0]?.kind).toBe("close");
		// 1000 = 0x03e8, big-endian.
		expect(frames[0]?.payload).toEqual(Buffer.from([0x03, 0xe8]));
	});

	it("CLOSE frame with no code produces an empty payload", () => {
		const close = encodeClose();
		const { frames } = decodeFrames(close);
		expect(frames[0]?.kind).toBe("close");
		expect(frames[0]?.payload).toEqual(Buffer.alloc(0));
	});
});

describe("frame codec — payload-length boundaries", () => {
	const cases: Array<{ name: string; size: number }> = [
		{ name: "inline (<=125)", size: 100 },
		{ name: "16-bit (126-65535)", size: 1000 },
		{ name: "64-bit (>65535)", size: 70000 },
	];

	for (const { name, size } of cases) {
		it(`round-trips a ${name} payload of ${size} bytes`, () => {
			const s = "x".repeat(size);
			const buf = encodeText(s);
			const { frames, rest } = decodeFrames(buf);
			expect(rest.length).toBe(0);
			expect(frames).toHaveLength(1);
			expect(frames[0]?.kind).toBe("text");
			expect(frames[0]?.payload).toBe(s);
		});
	}
});

describe("frame codec — streaming / partial buffers", () => {
	it("does not throw on a truncated buffer and returns leftover bytes in rest", () => {
		const full = encodeText("streaming payload here");
		const partial = full.subarray(0, full.length - 5);

		const first = decodeFrames(partial);
		expect(first.frames).toHaveLength(0);
		expect(first.rest.length).toBe(partial.length);

		// Feed rest + remaining bytes — frame should now complete.
		const remaining = full.subarray(full.length - 5);
		const completed = decodeFrames(Buffer.concat([first.rest, remaining]));
		expect(completed.rest.length).toBe(0);
		expect(completed.frames[0]?.payload).toBe("streaming payload here");
	});

	it("handles a truncated header (fewer than 2 bytes) without throwing", () => {
		const result = decodeFrames(Buffer.from([0x81]));
		expect(result.frames).toHaveLength(0);
		expect(result.rest.length).toBe(1);
	});

	it("does not throw when the 16-bit length field is half-arrived", () => {
		// base header + 1 of 2 extended-length bytes
		const buf = Buffer.from([0x81, 0x7e, 0x03]);
		const result = decodeFrames(buf);
		expect(result.frames).toHaveLength(0);
		expect(result.rest.length).toBe(buf.length);
	});

	it("does not throw when the 64-bit length field is partially arrived", () => {
		// base header + 2 of 8 extended-length bytes
		const buf = Buffer.from([0x81, 0x7f, 0x00, 0x00]);
		const result = decodeFrames(buf);
		expect(result.frames).toHaveLength(0);
		expect(result.rest.length).toBe(buf.length);
	});

	it("does not throw when a masked frame is truncated mid-mask-key", () => {
		const maskKey = Buffer.from([0x12, 0x34, 0x56, 0x78]);
		const full = maskedFrame(0x1, Buffer.from("payload", "utf8"), maskKey);
		// header is 2 bytes; slice to keep only 2 of the 4 mask-key bytes.
		const truncated = full.subarray(0, 4);
		const result = decodeFrames(truncated);
		expect(result.frames).toHaveLength(0);
		expect(result.rest.length).toBe(truncated.length);
	});

	it("decodes multiple concatenated frames in order", () => {
		const buf = Buffer.concat([
			encodeText("first"),
			encodeText("second"),
			encodeText("third"),
		]);
		const { frames, rest } = decodeFrames(buf);
		expect(rest.length).toBe(0);
		expect(frames.map((f) => f.payload)).toEqual(["first", "second", "third"]);
	});
});
