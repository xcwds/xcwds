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

	it('let the label profile push only claude/labels-* branches and edit only the label guide', () => {
		const pushes = PROFILES.label.filter((tool) => tool.startsWith('Bash(git push'));
		expect(pushes).toEqual(['Bash(git push -u origin claude/labels-:*)']);
		const edits = PROFILES.label.filter((tool) => /^(Edit|Write|MultiEdit)\b/.test(tool));
		expect(edits).toEqual(['Write(./.labeling/**)', 'Edit(**/.github/labels.md)']);
		expect(
			PROFILES.read.filter((tool) => tool.includes('push') || tool.includes('pr create'))
		).toEqual([]);
	});

	it('force read for a dry run', () => {
		expect(toolArgs('pr', { dryRun: true })).toBe(toolArgs('read'));
	});

	it('reject an unknown profile', () => {
		expect(() => toolArgs('admin')).toThrow('unknown tool profile');
	});
});
