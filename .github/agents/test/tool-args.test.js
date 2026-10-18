import { describe, expect, it } from 'vitest';
import { DISALLOWED, PROFILES, toolArgs } from '../bin/tool-args.mjs';

describe('tool profiles', () => {
	it('disallow gh pr merge in every profile', () => {
		for (const profile of Object.keys(PROFILES)) {
			expect(toolArgs(profile)).toContain('--disallowedTools "Bash(gh pr merge:*),');
		}
		expect(DISALLOWED).toContain('Bash(gh pr merge:*)');
	});

	it('give only the pr profile edits and a free shell', () => {
		expect(PROFILES.pr).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write']));
		for (const profile of ['read', 'label']) {
			expect(PROFILES[profile]).not.toContain('Bash');
			expect(PROFILES[profile]).not.toContain('Edit');
			expect(PROFILES[profile]).not.toContain('Write');
		}
		expect(PROFILES.read).not.toContain('Bash(gh api:*)');
	});

	it('force read for a dry run', () => {
		expect(toolArgs('pr', { dryRun: true })).toBe(toolArgs('read'));
	});

	it('reject an unknown profile', () => {
		expect(() => toolArgs('admin')).toThrow('unknown tool profile');
	});
});
