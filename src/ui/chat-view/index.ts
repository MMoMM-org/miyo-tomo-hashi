/**
 * Public surface of the chat-view module — re-exports the view class and the
 * registered view-type id used by Phase 5's `plugin.registerView` wire-up.
 *
 * Spec refs: spec 001-session-view phase-4 T4.3; SDD "Directory Map /
 * src/ui/chat-view/".
 */

export const VIEW_TYPE_TOMO_CHAT = "miyo-tomo-hashi-chat";
export { TomoChatView } from "./TomoChatView";
