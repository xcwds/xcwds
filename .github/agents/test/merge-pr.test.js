import { describe, expect, it } from 'vitest';
import { refusals } from '../bin/merge-pr.mjs';

const who = { bot: 'xcwds-agent', owner: 'xcwds', runId: '42' };

const green = {
	number: 7,
	state: 'OPEN',
	title: 'Fix the thing',
	isDraft: false,
	headRefName: 'claude/issue-xcwds-7',
	headRefOid: 'abc123',
	author: { login: 'app/xcwds-agent', is_bot: true },
	mergeable: 'MERGEABLE',
	statusCheckRollup: [
		{ __typename: 'CheckRun', name: 'checks', status: 'COMPLETED', conclusion: 'SUCCESS' },
		{ __typename: 'CheckRun', name: 'node-22', status: 'COMPLETED', conclusion: 'SKIPPED' },
		{ __typename: 'StatusContext', context: 'renovate/stability-days', state: 'SUCCESS' }
	]
};

const pr = (changes) => ({ ...green, ...changes });

describe('merge-pr', () => {
	it('merges a green, clean PR by the bot, Renovate or the owner', () => {
		expect(refusals(green, who)).toEqual([]);
		expect(refusals(pr({ author: { login: 'app/renovate', is_bot: true } }), who)).toEqual([]);
		expect(refusals(pr({ author: { login: 'xcwds', is_bot: false } }), who)).toEqual([]);
	});

	it('refuses a Version packages PR by its head or its title', () => {
		expect(refusals(pr({ headRefName: 'changeset-release/main' }), who)).toEqual([
			expect.stringContaining('Version packages')
		]);
		expect(refusals(pr({ title: ' version Packages ' }), who)).toEqual([
			expect.stringContaining('Version packages')
		]);
	});

	it('refuses a foreign author, including a user named like the bot', () => {
		expect(refusals(pr({ author: { login: 'someone', is_bot: false } }), who)).toEqual([
			expect.stringContaining('someone')
		]);
		expect(refusals(pr({ author: { login: 'xcwds-agent', is_bot: false } }), who)).toHaveLength(1);
		expect(refusals(pr({ author: { login: 'app/dependabot', is_bot: true } }), who)).toHaveLength(
			1
		);
		// A bot account named like the owner isn't the owner.
		expect(refusals(pr({ author: { login: 'app/xcwds', is_bot: true } }), who)).toHaveLength(1);
	});

	it('refuses red, pending or missing CI', () => {
		const failed = {
			__typename: 'CheckRun',
			name: 'checks',
			status: 'COMPLETED',
			conclusion: 'FAILURE'
		};
		const pending = {
			__typename: 'CheckRun',
			name: 'checks',
			status: 'IN_PROGRESS',
			conclusion: ''
		};
		const status = { __typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING' };
		expect(refusals(pr({ statusCheckRollup: [failed] }), who)).toEqual([
			"CI isn't green: checks failure"
		]);
		expect(refusals(pr({ statusCheckRollup: [pending] }), who)).toEqual([
			"CI isn't green: checks hasn't finished"
		]);
		expect(refusals(pr({ statusCheckRollup: [status] }), who)).toEqual([
			"CI isn't green: ci/legacy is pending"
		]);
		expect(refusals(pr({ statusCheckRollup: [] }), who)).toEqual(['no CI has run on its head']);
	});

	it("ignores this run's own check, but not other runs'", () => {
		const own = (id) => ({
			__typename: 'CheckRun',
			name: 'agent',
			status: 'IN_PROGRESS',
			conclusion: '',
			detailsUrl: `https://github.com/xcwds/xcwds/actions/runs/${id}/job/1`
		});
		expect(refusals(pr({ statusCheckRollup: [...green.statusCheckRollup, own(42)] }), who)).toEqual(
			[]
		);
		expect(refusals(pr({ statusCheckRollup: [own(43)] }), who)).toHaveLength(1);
	});

	it('refuses a conflict, an unknown merge state, a draft or a closed PR', () => {
		expect(refusals(pr({ mergeable: 'CONFLICTING' }), who)).toEqual(['it has a merge conflict']);
		expect(refusals(pr({ mergeable: 'UNKNOWN' }), who)).toHaveLength(1);
		expect(refusals(pr({ isDraft: true }), who)).toEqual(['it is a draft']);
		expect(refusals(pr({ state: 'MERGED' }), who)).toEqual(['it is merged']);
	});
});
