/**
 * Singleton IDE Bridge store. The bridge server is the only writer; UI surfaces
 * subscribe and compute derived values inline (mirrors connectionStore).
 *
 * Spec: docs/XDD/specs/003-ide-bridge — SDD "State Store".
 */

import { Store } from "../util/store";

import type { IdeBridgeState } from "./state";

export const ideBridgeStore = new Store<IdeBridgeState>({ kind: "stopped" });
