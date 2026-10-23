#!/usr/bin/env node
// Decides whether agent-followup.yml runs the agent (#204), before any secret or runner time is
// spent: on red CI or the owner's review of an open PR the bot opened on a claude/ branch, while
// no Issue to PR run is in progress. Runs with the workflow's own read-only token.
//
// Usage: followup-gate.mjs (in a workflow job; reads GITHUB_EVENT_NAME, GITHUB_EVENT_PATH,
// GITHUB_REPOSITORY, GITHUB_REPOSITORY_OWNER and GITHUB_OUTPUT, and calls `gh api`)

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Fix pushes this workflow makes per PR between two rounds of the owner's activity. */
export const MAX_FIXES = 3;

/** The trailer on every commit this workflow pushes, which is how its fixes are counted. */
export const TRAILER = 'Agent-Followup:';

/**
 * Whether a text tags @claude, which the mention workflow answers. The same test as its `if`
 * (GitHub's `contains` ignores case), so every review goes to exactly one of the two.
 */
export const mentions = (text) => (text ?? '').toLowerCase().includes('@claude');

/**
 * The PR an event is about, or why it's skipped.
 * @returns {{ number?: number, branch?: string, sha?: string, skip?: string }}
 */
export function fromEvent(name, event, { repo, owner }) {
	if (name === 'workflow_run') {
		const run = event.workflow_run;
		if (run.conclusion !== 'failure') return { skip: `CI ${run.conclusion}, not failed` };
		if (run.event !== 'pull_request') return { skip: `CI ran for ${run.event}, not a PR` };
		if (run.head_repository?.full_name !== repo) return { skip: 'the PR comes from a fork' };
		if (!run.head_branch?.startsWith('claude/'))
			return { skip: `${run.head_branch} isn't a claude/ branch` };
		const number = run.pull_requests?.find((pr) => pr.head?.ref === run.head_branch)?.number;
		return { number, branch: run.head_branch, sha: run.head_sha };
	}
	if (name === 'pull_request_review') {
		const { review, pull_request: pr } = event;
		if (review.user?.login !== owner) return { skip: `the review is by ${review.user?.login}` };
		if (!['changes_requested', 'commented'].includes(review.state))
			return { skip: `the review is ${review.state}` };
		if (mentions(review.body)) return { skip: 'the review tags @claude' };
		return { number: pr.number, branch: pr.head.ref };
	}
	return { skip: `${name} isn't an event this workflow handles` };
}

/** Why the agent leaves this PR alone, or undefined when it's one of the bot's own. */
export function prProblem(pr, { repo }) {
	if (pr.state !== 'open') return `#${pr.number} is ${pr.merged_at ? 'merged' : pr.state}`;
	if (pr.head.repo?.full_name !== repo) return `#${pr.number} comes from a fork`;
	if (!pr.head.ref.startsWith('claude/')) return `#${pr.number} isn't on a claude/ branch`;
	if (pr.user.type !== 'Bot' || pr.user.login === 'renovate[bot]')
		return `#${pr.number} is by ${pr.user.login}, not the agent`;
	return undefined;
}

/** When the owner last reviewed, commented on or pushed to the PR (ms, or 0 for never). */
export function lastOwnerActivity({ reviews, reviewComments, comments, commits }, owner) {
	const times = [
		...reviews.filter((r) => r.user?.login === owner).map((r) => r.submitted_at),
		...reviewComments.filter((c) => c.user?.login === owner).map((c) => c.created_at),
		...comments.filter((c) => c.user?.login === owner).map((c) => c.created_at),
		...commits.filter((c) => c.author?.login === owner).map((c) => c.commit.committer.date)
	];
	return Math.max(0, ...times.filter(Boolean).map((t) => Date.parse(t)));
}

/** This workflow's fix pushes since the owner's last activity, counted by their trailer. */
export function fixesSince(commits, since) {
	return commits.filter(
		(c) =>
			c.commit.message.split('\n').some((line) => line.startsWith(TRAILER)) &&
			Date.parse(c.commit.committer.date) > since
	).length;
}

/** The Context section of the agent's prompt. */
export function context({ name, event, repo, number, fixes }) {
	const lines = [];
	if (name === 'workflow_run') {
		const run = event.workflow_run;
		lines.push(`CI failed on ${repo}#${number} at ${run.head_sha.slice(0, 7)}: ${run.html_url}.`);
	} else {
		const { review } = event;
		const state = review.state === 'changes_requested' ? 'requested changes' : 'commented';
		lines.push(
			`The owner (@${review.user.login}) ${state} on ${repo}#${number}: ${review.html_url}.`
		);
	}
	lines.push(
		'',
		`Fix pushes from this workflow since the owner's last activity on the PR: ${fixes} of ${MAX_FIXES}.`
	);
	return lines.join('\n');
}

function api(path, { paginate = false } = {}) {
	const args = ['api', '-H', 'Accept: application/vnd.github+json', path];
	if (paginate) args.push('--paginate', '--slurp');
	const out = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	const data = JSON.parse(out);
	return paginate ? data.flat() : data;
}

/** Runs of a workflow in the given states; none when the workflow doesn't exist yet. */
function runsOf(repo, workflow, statuses) {
	let total = 0;
	for (const status of statuses) {
		try {
			total += api(
				`repos/${repo}/actions/workflows/${workflow}/runs?status=${status}&per_page=1`
			).total_count;
		} catch (error) {
			if (!/HTTP 404/.test(String(error.stderr ?? error.message))) throw error;
		}
	}
	return total;
}

function main() {
	const name = process.env.GITHUB_EVENT_NAME;
	const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
	const repo = process.env.GITHUB_REPOSITORY;
	const owner = process.env.GITHUB_REPOSITORY_OWNER;
	const output = (values) => {
		const text = Object.entries(values)
			.map(([key, value]) => `${key}<<EOF_GATE\n${value}\nEOF_GATE\n`)
			.join('');
		appendFileSync(process.env.GITHUB_OUTPUT, text);
	};
	const skip = (reason) => {
		console.log(`::notice::Not running: ${reason}.`);
		output({ run: 'false' });
	};

	const found = fromEvent(name, event, { repo, owner });
	if (found.skip) return skip(found.skip);
	let number = found.number;
	if (!number) {
		// workflow_run leaves pull_requests empty at times; look the PR up by its branch.
		const open = api(`repos/${repo}/pulls?state=open&head=${owner}:${found.branch}`);
		if (open.length !== 1) return skip(`no open PR for ${found.branch}`);
		number = open[0].number;
	}

	const pr = api(`repos/${repo}/pulls/${number}`);
	const problem = prProblem(pr, { repo });
	if (problem) return skip(problem);
	if (found.sha && found.sha !== pr.head.sha)
		return skip(`#${number} has a newer head than the failed run, and CI runs again on it`);

	if (name === 'pull_request_review') {
		const comments = api(`repos/${repo}/pulls/${number}/reviews/${event.review.id}/comments`, {
			paginate: true
		});
		if (comments.some((c) => mentions(c.body))) return skip('a comment in the review tags @claude');
	}

	// Issue to PR fixes its own PR's CI in the same run; two agents never push to one branch.
	const busy = runsOf(`${owner}/xcwds`, 'agent-issue-to-pr.yml', ['in_progress', 'queued']);
	if (busy > 0) return skip('an Issue to PR run is in progress, and it finishes its own PRs');

	const activity = {
		reviews: api(`repos/${repo}/pulls/${number}/reviews`, { paginate: true }),
		reviewComments: api(`repos/${repo}/pulls/${number}/comments`, { paginate: true }),
		comments: api(`repos/${repo}/issues/${number}/comments`, { paginate: true }),
		commits: api(`repos/${repo}/pulls/${number}/commits`, { paginate: true })
	};
	const fixes = fixesSince(activity.commits, lastOwnerActivity(activity, owner));

	console.log(`::notice::Following up on #${number} (${fixes} of ${MAX_FIXES} fixes used).`);
	output({
		run: 'true',
		pr: String(number),
		context: context({ name, event, repo, number, fixes })
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (error) {
		console.error(`followup-gate: ${error.message}`);
		process.exit(1);
	}
}
