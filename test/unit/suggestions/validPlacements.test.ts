import { describe, it, expect } from 'vitest';
import { validPlacements } from '../../../src/suggestions/validPlacements';

describe('validPlacements', () => {
	describe('callout anchor type', () => {
		it('should offer inside, before, and after placements for callout', () => {
			const result = validPlacements('callout');
			expect(result).toEqual(['inside', 'before', 'after']);
		});

		it('should include inside placement in callout result', () => {
			const result = validPlacements('callout');
			expect(result).toContain('inside');
		});

		it('should include before placement in callout result', () => {
			const result = validPlacements('callout');
			expect(result).toContain('before');
		});

		it('should include after placement in callout result', () => {
			const result = validPlacements('callout');
			expect(result).toContain('after');
		});
	});

	describe('heading anchor type', () => {
		it('should offer only before and after placements for heading', () => {
			const result = validPlacements('heading');
			expect(result).toEqual(['before', 'after']);
		});

		it('should NOT include inside placement for heading', () => {
			const result = validPlacements('heading');
			expect(result).not.toContain('inside');
		});

		it('should include before placement for heading', () => {
			const result = validPlacements('heading');
			expect(result).toContain('before');
		});

		it('should include after placement for heading', () => {
			const result = validPlacements('heading');
			expect(result).toContain('after');
		});
	});

	describe('line anchor type', () => {
		it('should offer only before and after placements for line', () => {
			const result = validPlacements('line');
			expect(result).toEqual(['before', 'after']);
		});

		it('should NOT include inside placement for line', () => {
			const result = validPlacements('line');
			expect(result).not.toContain('inside');
		});

		it('should include before placement for line', () => {
			const result = validPlacements('line');
			expect(result).toContain('before');
		});

		it('should include after placement for line', () => {
			const result = validPlacements('line');
			expect(result).toContain('after');
		});
	});
});
