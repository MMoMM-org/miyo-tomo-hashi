import type { AnchorWire } from '../types/suggestions';

/**
 * Anchor types — reused from AnchorWire to ensure alignment with executor contract.
 */
export type AnchorType = AnchorWire['type'];

/**
 * Placement types — reused from AnchorWire to ensure alignment with executor contract.
 */
export type Placement = AnchorWire['placement'];

/**
 * Computes the valid placements for a given anchor type, filtered to only
 * placements that the executor's anchorResolver will actually honour.
 *
 * The executor hard-fails `inside` on headings and lines (it only supports
 * `inside` for callouts), so this function prevents the editor from offering
 * unexecutable placements to the user.
 *
 * @param anchorType - The anchor type (heading, callout, or line).
 * @returns The list of valid placements for this anchor type.
 */
export function validPlacements(anchorType: AnchorType): readonly Placement[] {
	switch (anchorType) {
		case 'callout':
			return ['inside', 'before', 'after'] as const;
		case 'heading':
			return ['before', 'after'] as const;
		case 'line':
			return ['before', 'after'] as const;
	}
}
