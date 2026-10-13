/**
 * Rename-target names for attachment conflicts (#141).
 *
 * Tomo's Pass 2 refuses a typed `proposed_name` for six reasons (QA handoff
 * 2026-10-13 §1.1): blank, `/`, edge whitespace, `{{` / `<%` / control
 * characters, `\ : * ? " < > |`, and the link-breaking `# ^ [ ]`. The editor
 * never sends a name that would trip one of them: every offending character
 * becomes "-" (owner ruling — replaced visibly, never silently dropped) and
 * the edges are trimmed. Only blank remains, and the UI refuses that inline.
 *
 * `<%` needs no rule of its own: its `<` is already forbidden.
 */

const FORBIDDEN_CHARS = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|", "#", "^", "[", "]"]);

/** C0 controls and DEL — checked by code point (a regex range would trip no-control-regex). */
function isControl(char: string): boolean {
	const code = char.charCodeAt(0);
	return code <= 0x1f || code === 0x7f;
}

export interface SanitisedName {
	readonly cleaned: string;
	/** True when `cleaned` differs from the input — the UI says so under the field. */
	readonly changed: boolean;
}

export function sanitiseAttachmentName(raw: string): SanitisedName {
	// Trim first so edge tabs/newlines vanish rather than turning into "-".
	const replaced = Array.from(raw.trim().replace(/\{\{/g, "-"))
		.map((char) => (FORBIDDEN_CHARS.has(char) || isControl(char) ? "-" : char))
		.join("");
	const cleaned = replaced.trim();
	return { cleaned, changed: cleaned !== raw };
}

/** The last segment of a vault path. */
export function basenameOf(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

/** Everything before the last separator; "" for a root-level path. */
export function dirnameOf(path: string): string {
	const sep = path.lastIndexOf("/");
	return sep === -1 ? "" : path.slice(0, sep);
}
