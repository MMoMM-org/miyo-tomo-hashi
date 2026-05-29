/**
 * Hand-rolled RFC 6455 WebSocket frame codec for the IDE Bridge — the byte-level
 * transport beneath the JSON-RPC protocol. Kept dependency-free per ADR-1 (zero
 * new deps): we only need TEXT plus the PING/PONG/CLOSE control frames, so a
 * tiny codec is cheaper and more auditable than pulling in a full `ws` stack.
 *
 * Scope (deliberately minimal): TEXT + PING/PONG/CLOSE only. No binary frames,
 * no fragmentation (FIN is always assumed set), no extensions/RSV bits.
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD transport notes; frame layout per
 * RFC 6455 §5.2. Servers MUST emit unmasked frames; clients MUST mask, so we
 * unmask on decode and never mask on encode.
 */

/** Opcodes we care about (RFC 6455 §5.2). */
const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** FIN bit set, no RSV — the only first-byte shape we ever emit. */
const FIN = 0x80;

export type DecodedFrame =
	| { kind: "text"; payload: string }
	| { kind: "ping"; payload: Buffer }
	| { kind: "pong"; payload: Buffer }
	| { kind: "close"; payload: Buffer }
	| { kind: "other"; opcode: number; payload: Buffer };

/** Build an unmasked server frame header + payload for a given opcode. */
function encodeFrame(opcode: number, payload: Buffer): Buffer {
	const len = payload.length;
	let header: Buffer;
	if (len < 126) {
		header = Buffer.from([FIN | opcode, len]);
	} else if (len <= 0xffff) {
		header = Buffer.alloc(4);
		header[0] = FIN | opcode;
		header[1] = 126;
		header.writeUInt16BE(len, 2);
	} else {
		header = Buffer.alloc(10);
		header[0] = FIN | opcode;
		header[1] = 127;
		header.writeBigUInt64BE(BigInt(len), 2);
	}
	return Buffer.concat([header, payload]);
}

/** Server→client TEXT frame, unmasked. */
export function encodeText(s: string): Buffer {
	return encodeFrame(OP_TEXT, Buffer.from(s, "utf8"));
}

/** Unmasked PING control frame. */
export function encodePing(payload: Buffer = Buffer.alloc(0)): Buffer {
	return encodeFrame(OP_PING, payload);
}

/** Unmasked PONG control frame. */
export function encodePong(payload: Buffer = Buffer.alloc(0)): Buffer {
	return encodeFrame(OP_PONG, payload);
}

/** CLOSE frame; optional 2-byte big-endian status code as payload. */
export function encodeClose(code?: number): Buffer {
	if (code === undefined) {
		return encodeFrame(OP_CLOSE, Buffer.alloc(0));
	}
	const payload = Buffer.alloc(2);
	payload.writeUInt16BE(code, 0);
	return encodeFrame(OP_CLOSE, payload);
}

function classify(opcode: number, payload: Buffer): DecodedFrame {
	switch (opcode) {
		case OP_TEXT:
			return { kind: "text", payload: payload.toString("utf8") };
		case OP_PING:
			return { kind: "ping", payload };
		case OP_PONG:
			return { kind: "pong", payload };
		case OP_CLOSE:
			return { kind: "close", payload };
		default:
			return { kind: "other", opcode, payload };
	}
}

/**
 * Decode zero or more complete frames from `buffer`. Trailing bytes that do not
 * form a complete frame are returned in `rest` — the caller re-feeds them once
 * more data arrives. Never throws on a truncated buffer.
 */
export function decodeFrames(buffer: Buffer): {
	frames: DecodedFrame[];
	rest: Buffer;
} {
	const frames: DecodedFrame[] = [];
	let offset = 0;

	while (offset + 2 <= buffer.length) {
		const byte0 = buffer[offset] as number;
		const byte1 = buffer[offset + 1] as number;
		const opcode = byte0 & 0x0f;
		const masked = (byte1 & 0x80) !== 0;
		let payloadLen = byte1 & 0x7f;

		let cursor = offset + 2;

		if (payloadLen === 126) {
			if (cursor + 2 > buffer.length) break;
			payloadLen = buffer.readUInt16BE(cursor);
			cursor += 2;
		} else if (payloadLen === 127) {
			if (cursor + 8 > buffer.length) break;
			payloadLen = Number(buffer.readBigUInt64BE(cursor));
			cursor += 8;
		}

		let maskKey: Buffer | undefined;
		if (masked) {
			if (cursor + 4 > buffer.length) break;
			maskKey = buffer.subarray(cursor, cursor + 4);
			cursor += 4;
		}

		if (cursor + payloadLen > buffer.length) break;

		let payload = buffer.subarray(cursor, cursor + payloadLen);
		if (masked && maskKey) {
			const unmasked = Buffer.alloc(payloadLen);
			for (let i = 0; i < payloadLen; i++) {
				unmasked[i] = (payload[i] as number) ^ (maskKey[i % 4] as number);
			}
			payload = unmasked;
		}

		frames.push(classify(opcode, payload));
		offset = cursor + payloadLen;
	}

	return { frames, rest: buffer.subarray(offset) };
}
