/**
 * Connection state machine — the single source of truth for whether Hashi is
 * attached to a Tomo container and, if not, why.
 *
 * Spec: docs/XDD/specs/001-session-view — SDD "Application Data Models".
 */

import type { ConnectionError, TomoInstance } from "./types";

export type ConnectionState =
	| { kind: "disconnected"; reason?: ConnectionError }
	| { kind: "attaching"; target: TomoInstance }
	| { kind: "connected"; instance: TomoInstance }
	| {
			kind: "reconnecting";
			target: TomoInstance;
			attempt: number;
			nextDelayMs: number;
	  };

// The previous v1.1 SDD also declared `{ kind: "error"; error; lastKnown? }`.
// It was never the destination of any transition in the Runtime View — every
// failure path the SDD describes lands in `disconnected{reason}` — and was
// removed in the 2026-04-28 review-fix pass to keep the exhaustive switch
// over `kind` minimal. Use `disconnected{reason}` for failed transitions.
