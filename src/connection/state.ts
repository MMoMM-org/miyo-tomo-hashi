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
	  }
	| { kind: "error"; error: ConnectionError; lastKnown?: TomoInstance };
