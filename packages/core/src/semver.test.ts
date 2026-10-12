import { describe, expect, it } from 'vitest';
import { satisfies, validRange } from './semver.js';

describe('satisfies', () => {
	it.each([
		['1.2.3', '^1.0.0', true],
		['2.0.0', '^1.0.0', false],
		['0.2.5', '^0.2.0', true],
		['0.3.0', '^0.2.0', false],
		['0.0.3', '^0.0.3', true],
		['0.0.4', '^0.0.3', false],
		['1.2.9', '~1.2.0', true],
		['1.3.0', '~1.2.0', false],
		['1.5.0', '1.x', true],
		['2.0.0', '1', false],
		['1.2.3', '1.2.3', true],
		['1.2.4', '=1.2.3', false],
		['3.0.0', '>=2.0.0 <4', true],
		['4.0.0', '>=2.0.0 <4', false],
		['5.0.0', '^1.0.0 || ^5.0.0', true],
		['9.9.9', '*', true],
		['0.0.0', '*', true],
		['2.0.0', '>1.x', true],
		['1.9.0', '>1.x', false],
		['1.9.0', '<=1.x', true],
		['2.0.0-beta.1', '^1.0.0', false],
		['2.0.0-beta.1', '^2.0.0-beta.0', true],
		['2.0.0-beta.1', '*', false],
		// Prerelease identifiers compare one by one, numerically when both are numbers (#58).
		['0.2.0-beta.10', '>=0.2.0-beta.2', true],
		['0.2.0-beta.2', '>=0.2.0-beta.10', false],
		['0.2.0-beta', '>=0.2.0-beta.1', false],
		['0.2.0-beta.1', '>=0.2.0-alpha.9', true],
		['0.2.0-1', '>=0.2.0-alpha', false],
		['0.2.0-rc.1', '<0.2.0', false],
		// Hyphen ranges (#58).
		['1.2.3', '1.2.3 - 2.0.0', true],
		['2.0.0', '1.2.3 - 2.0.0', true],
		['2.0.1', '1.2.3 - 2.0.0', false],
		['1.2.2', '1.2.3 - 2.0.0', false],
		['1.2.0', '1.2 - 2', true],
		['2.9.9', '1.2 - 2', true],
		['3.0.0', '1.2 - 2', false],
		['2.3.9', '1 - 2.3', true],
		['2.4.0', '1 - 2.3', false],
		['0.5.0', '0.1.0 - 0.2.0 || ^0.5.0', true],
		['1.0.0', 'not a range', false],
		['nope', '*', false]
	])('%s in %s → %s', (version, range, expected) => {
		expect(satisfies(version, range)).toBe(expected);
	});
});

describe('validRange', () => {
	it('accepts what satisfies understands and rejects the rest', () => {
		for (const range of ['^0.1.0', '>=1 <2', '1.2.3 - 2', '1.x || ^3.0.0-beta.1', '*', ''])
			expect(validRange(range), range).toBe(true);
		for (const range of ['not a range', '^one', '1.2.3.4', '1.2.3 -', 'latest'])
			expect(validRange(range), range).toBe(false);
	});
});
