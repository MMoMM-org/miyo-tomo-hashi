/**
 * Connection domain types — descriptors for a Tomo Docker container instance and
 * the error space surfaced by the connection lifecycle.
 *
 * Spec: docs/XDD/specs/001-session-view — SDD "Application Data Models".
 */

export interface TomoInstance {
	/** Full Docker container ID. */
	readonly containerId: string;
	/** First 12 chars of containerId — used for display. */
	readonly shortId: string;
	/** From label `miyo.tomo.instance-name`; null if absent. */
	readonly name: string | null;
	/** From `docker inspect` State.StartedAt. */
	readonly startedAt: Date;
	/** Image reference — diagnostic tooltip only. */
	readonly image: string;
}

/**
 * Discriminated union of every connection failure surfaced by the attach
 * pipeline. `attach-failed` is intentionally broad — covers
 * chosen-instance-gone, stream-error, and reconnect-exhausted.
 */
export type ConnectionError =
	| { code: "daemon-unreachable"; detail: string }
	| { code: "socket-permission-denied"; detail: string }
	| {
			code: "no-instances";
			detail: "No Tomo instance seems to be running — start one and try again.";
	  }
	| { code: "attach-failed"; detail: string };
