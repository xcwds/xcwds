#!/usr/bin/env node
// The only way an agent run merges a PR (`gh pr merge` is disallowed in every tool profile).
// Squash-merges only when every rule in `refusals` passes, and prints why when it refuses.
//
// Usage: merge-pr <number> [--repo owner/name]
// Reads AGENT_BOT_SLUG (the app's slug) and AGENT_OWNER (the repos' owner), which agent.yml sets.

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const FIELDS = [
	'number',
	'state',
	'title',
	'isDraft',
	'headRefName',
	'headRefOid',
	'author',
	'mergeable',
	'statusCheckRollup'
];
const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

/** The account's login without gh's `app/` prefix or the `[bot]` suffix. */
const bare = (login) => login.replace(/^app\//, '').replace(/\[bot\]$/, '');

/** Why a check isn't green, or undefined when it is. */
function checkProblem(check) {
	if (check.__typename === 'StatusContext') {
		return check.state === 'SUCCESS'
			? undefined
			: `${check.context} is ${check.state.toLowerCase()}`;
	}
	if (check.status !== 'COMPLETED') return `${check.name} hasn't finished`;
	return PASSING.has(check.conclusion)
		? undefined
		: `${check.name} ${check.conclusion.toLowerCase()}`;
}

/**
 * Every reason this PR must not be merged (empty when it may be).
 * @param {object} pr `gh pr view --json` output with FIELDS
 * @param {{ bot: string, owner: string, runId?: string }} who the app's slug, the repos' owner and
 *   this workflow run's id (its own checks, when it runs on the PR, never count)
 */
export function refusals(pr, { bot, owner, runId }) {
	const reasons = [];
	if (pr.state !== 'OPEN') reasons.push(`it is ${pr.state.toLowerCase()}`);
	if (
		pr.headRefName.startsWith('changeset-release/') ||
		/^version packages$/i.test(pr.title.trim())
	) {
		reasons.push(
			'it is a Version packages PR, which publishes to npm: only the owner merges those'
		);
	}
	const login = bare(pr.author.login);
	const allowed = pr.author.is_bot ? [bot, 'renovate'].includes(login) : login === owner;
	if (!allowed) reasons.push(`its author ${pr.author.login} isn't the bot, Renovate or the owner`);
	if (pr.isDraft) reasons.push('it is a draft');

	const checks = (pr.statusCheckRollup ?? []).filter(
		(check) => !runId || !check.detailsUrl?.includes(`/actions/runs/${runId}/`)
	);
	if (checks.length === 0) reasons.push('no CI has run on its head');
	for (const check of checks) {
		const problem = checkProblem(check);
		if (problem) reasons.push(`CI isn't green: ${problem}`);
	}

	if (pr.mergeable === 'CONFLICTING') reasons.push('it has a merge conflict');
	else if (pr.mergeable !== 'MERGEABLE')
		reasons.push("GitHub hasn't worked out whether it merges cleanly");
	return reasons;
}

function gh(args) {
	return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: { repo: { type: 'string' } }
	});
	const [number] = positionals;
	if (!/^\d+$/.test(number ?? '')) throw new Error('usage: merge-pr <number> [--repo owner/name]');
	const bot = process.env.AGENT_BOT_SLUG;
	const owner = process.env.AGENT_OWNER;
	if (!bot || !owner) throw new Error('AGENT_BOT_SLUG and AGENT_OWNER must be set');
	const repo = values.repo ? ['--repo', values.repo] : [];

	let pr;
	// GitHub computes mergeability lazily: UNKNOWN right after a push usually settles within seconds.
	for (let attempt = 0; attempt < 6; attempt++) {
		pr = JSON.parse(gh(['pr', 'view', number, ...repo, '--json', FIELDS.join(',')]));
		if (pr.mergeable !== 'UNKNOWN') break;
		await new Promise((resolve) => setTimeout(resolve, 5000));
	}

	const reasons = refusals(pr, { bot, owner, runId: process.env.GITHUB_RUN_ID });
	if (reasons.length > 0) {
		console.error(`merge-pr: not merging #${number}:\n${reasons.map((r) => `- ${r}`).join('\n')}`);
		process.exit(1);
	}
	// --match-head-commit: refuse if someone pushed after the checks above.
	gh(['pr', 'merge', number, ...repo, '--squash', '--match-head-commit', pr.headRefOid]);
	console.log(`merge-pr: squash-merged #${number}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(`merge-pr: ${error.message}`);
		process.exit(1);
	});
}
