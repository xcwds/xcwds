import { describe, expect, it } from 'vitest';
import {
	context,
	fixesSince,
	fromEvent,
	lastOwnerActivity,
	mentions,
	prProblem
} from '../bin/followup-gate.mjs';

const where = { repo: 'xcwds/xcwds', owner: 'xcwds' };

const failedRun = {
	workflow_run: {
		conclusion: 'failure',
		event: 'pull_request',
		head_branch: 'claude/issue-xcwds-7',
		head_sha: 'abc1234def',
		html_url: 'https://github.com/xcwds/xcwds/actions/runs/1',
		head_repository: { full_name: 'xcwds/xcwds' },
		pull_requests: [{ number: 7, head: { ref: 'claude/issue-xcwds-7' } }]
	}
};
const run = (changes) => ({ workflow_run: { ...failedRun.workflow_run, ...changes } });

const review = (changes) => ({
	review: {
		id: 3,
		state: 'changes_requested',
		body: 'Please rename this.',
		user: { login: 'xcwds' },
		html_url: 'https://github.com/xcwds/xcwds/pull/7#pullrequestreview-3',
		...changes
	},
	pull_request: { number: 7, head: { ref: 'claude/issue-xcwds-7' } }
});

const openPr = {
	number: 7,
	state: 'open',
	merged_at: null,
	user: { login: 'xcwds-agent[bot]', type: 'Bot' },
	head: { ref: 'claude/issue-xcwds-7', sha: 'abc1234def', repo: { full_name: 'xcwds/xcwds' } }
};
const pr = (changes) => ({ ...openPr, ...changes });

const commit = (date, message = 'Fix it', login = 'xcwds-agent[bot]') => ({
	author: { login },
	commit: { message, committer: { date } }
});

describe('followup-gate', () => {
	it('takes a failed CI run on a claude/ PR', () => {
		expect(fromEvent('workflow_run', failedRun, where)).toEqual({
			number: 7,
			branch: 'claude/issue-xcwds-7',
			sha: 'abc1234def'
		});
		// No PR in the payload: the gate looks it up by branch.
		expect(fromEvent('workflow_run', run({ pull_requests: [] }), where).number).toBeUndefined();
	});

	it('skips green CI, push runs, forks and other branches', () => {
		expect(fromEvent('workflow_run', run({ conclusion: 'success' }), where).skip).toBeTruthy();
		expect(fromEvent('workflow_run', run({ conclusion: 'cancelled' }), where).skip).toBeTruthy();
		expect(fromEvent('workflow_run', run({ event: 'push' }), where).skip).toBeTruthy();
		expect(
			fromEvent('workflow_run', run({ head_repository: { full_name: 'x/xcwds' } }), where).skip
		).toBeTruthy();
		expect(fromEvent('workflow_run', run({ head_branch: 'renovate/x' }), where).skip).toBeTruthy();
	});

	it("takes the owner's requested changes and comments, nothing else", () => {
		expect(fromEvent('pull_request_review', review(), where)).toEqual({
			number: 7,
			branch: 'claude/issue-xcwds-7'
		});
		expect(fromEvent('pull_request_review', review({ state: 'commented' }), where).number).toBe(7);
		expect(
			fromEvent('pull_request_review', review({ state: 'approved' }), where).skip
		).toBeTruthy();
		expect(
			fromEvent('pull_request_review', review({ user: { login: 'someone' } }), where).skip
		).toBeTruthy();
		expect(fromEvent('issue_comment', {}, where).skip).toBeTruthy();
	});

	it('leaves reviews that tag @claude to the mention workflow', () => {
		expect(
			fromEvent('pull_request_review', review({ body: '@claude rename this' }), where).skip
		).toMatch(/@claude/);
		expect(mentions('Hey @Claude, look')).toBe(true);
		expect(mentions('@claude')).toBe(true);
		// The mention workflow's `contains` takes these too, so they go there.
		expect(mentions('@claudette')).toBe(true);
		expect(mentions('mail claude@example.com')).toBe(false);
		expect(mentions(null)).toBe(false);
	});

	it("follows up only on the bot's own open claude/ PRs", () => {
		expect(prProblem(openPr, where)).toBeUndefined();
		expect(prProblem(pr({ state: 'closed', merged_at: '2026-10-23T00:00:00Z' }), where)).toMatch(
			/merged/
		);
		expect(prProblem(pr({ state: 'closed' }), where)).toMatch(/closed/);
		expect(prProblem(pr({ user: { login: 'xcwds', type: 'User' } }), where)).toMatch(/xcwds/);
		expect(prProblem(pr({ user: { login: 'renovate[bot]', type: 'Bot' } }), where)).toMatch(
			/renovate/
		);
		expect(prProblem(pr({ head: { ...openPr.head, ref: 'main' } }), where)).toMatch(/claude/);
		expect(
			prProblem(pr({ head: { ...openPr.head, repo: { full_name: 'x/xcwds' } } }), where)
		).toMatch(/fork/);
	});

	it("counts this workflow's fixes since the owner's last activity", () => {
		const trailer = 'Fix the test\n\nAgent-Followup: https://github.com/xcwds/xcwds/actions/runs/1';
		const commits = [
			commit('2026-10-23T10:00:00Z'),
			commit('2026-10-23T11:00:00Z', trailer),
			commit('2026-10-23T12:00:00Z', 'Owner tweak', 'xcwds'),
			commit('2026-10-23T13:00:00Z', trailer),
			commit('2026-10-23T14:00:00Z', trailer),
			commit('2026-10-23T15:00:00Z', 'Agent-Followup in the subject is not a trailer')
		];
		const activity = (changes) => ({
			reviews: [],
			reviewComments: [],
			comments: [],
			commits,
			...changes
		});

		const ownerPush = lastOwnerActivity(activity(), 'xcwds');
		expect(ownerPush).toBe(Date.parse('2026-10-23T12:00:00Z'));
		expect(fixesSince(commits, ownerPush)).toBe(2);
		expect(fixesSince(commits, 0)).toBe(3);

		// A later review or comment by the owner starts a new round; other people's don't.
		const reviewed = lastOwnerActivity(
			activity({
				reviews: [
					{ user: { login: 'xcwds' }, submitted_at: '2026-10-23T13:30:00Z' },
					{ user: { login: 'xcwds-agent[bot]' }, submitted_at: '2026-10-23T16:00:00Z' },
					{ user: { login: 'xcwds' }, submitted_at: null }
				],
				comments: [{ user: { login: 'someone' }, created_at: '2026-10-23T16:00:00Z' }]
			}),
			'xcwds'
		);
		expect(fixesSince(commits, reviewed)).toBe(1);
		expect(lastOwnerActivity(activity({ commits: [] }), 'xcwds')).toBe(0);
	});

	it("doesn't count the agent's comments as the owner's, only the owner's own", () => {
		const viaAgent = { owner: { login: 'xcwds' }, slug: 'gwgsbot' };
		const viaClaude = { owner: { login: 'anthropics' }, slug: 'claude' };
		const at = (comments) =>
			lastOwnerActivity({ reviews: [], reviewComments: [], comments, commits: [] }, 'xcwds');
		const comment = { user: { login: 'xcwds' }, created_at: '2026-10-23T16:00:00Z' };
		expect(at([{ ...comment, performed_via_github_app: viaAgent }])).toBe(0);
		expect(at([{ ...comment, performed_via_github_app: viaClaude }])).toBe(
			Date.parse('2026-10-23T16:00:00Z')
		);
		expect(at([comment])).toBe(Date.parse('2026-10-23T16:00:00Z'));
	});

	it('tells the agent what happened and how many fixes it has left', () => {
		const ci = context({
			name: 'workflow_run',
			event: failedRun,
			repo: 'xcwds/xcwds',
			number: 7,
			fixes: 1
		});
		expect(ci).toContain('CI failed on xcwds/xcwds#7 at abc1234');
		expect(ci).toContain('1 of 3');
		const owner = context({
			name: 'pull_request_review',
			event: review({ state: 'commented' }),
			repo: 'xcwds/xcwds',
			number: 7,
			fixes: 0
		});
		expect(owner).toContain('@xcwds) commented on xcwds/xcwds#7');
	});
});
