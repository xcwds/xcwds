#!/usr/bin/env node
// The tool profiles agent.yml's `tools` input picks from, as Claude Code CLI arguments.
//
// Usage: tool-args.mjs <read|label|pr>
//
// These keep each routine to what it needs, but they are a guardrail, not a sandbox: the app's
// tokens can do more than any profile allows, so merge-pr's checks and the branch rulesets on main
// (AGENTS.md, "Agent workflows") are what actually hold.

import { fileURLToPath } from 'node:url';

const READ = [
	'Read',
	'Glob',
	'Grep',
	'LS',
	'TodoWrite',
	'Bash(gh pr list:*)',
	'Bash(gh pr view:*)',
	'Bash(gh pr diff:*)',
	'Bash(gh pr checks:*)',
	'Bash(gh issue list:*)',
	'Bash(gh issue view:*)',
	'Bash(gh label list:*)',
	'Bash(gh run list:*)',
	'Bash(gh run view:*)',
	'Bash(gh search:*)',
	'Bash(git log:*)',
	'Bash(git show:*)',
	'Bash(git diff:*)',
	'Bash(git status:*)',
	'Bash(git config --get:*)',
	'Bash(ls:*)',
	'Bash(agent-token status)',
	'Bash(agent-token refresh)',
	'Bash(agent-token identity)'
];

const LABEL = [
	...READ,
	'Bash(gh issue edit:*)',
	'Bash(gh issue comment:*)',
	'Bash(gh issue create:*)',
	'Bash(gh pr edit:*)',
	'Bash(gh pr comment:*)',
	'Bash(gh api:*)',
	// Refinement writes issue bodies to a scratch file first (gh issue edit --body-file).
	'Write(./.labeling/**)',
	// A gap in the label guide becomes a PR on a claude/labels-* branch (labeling.md), which the
	// owner merges.
	'Edit(**/.github/labels.md)',
	'Bash(git fetch origin main)',
	'Bash(git switch -c claude/labels-:*)',
	'Bash(pnpm exec prettier --write .github/labels.md)',
	'Bash(git add .github/labels.md)',
	'Bash(git commit:*)',
	'Bash(git push -u origin claude/labels-:*)',
	'Bash(gh pr create:*)'
];

// Everything else a contributor does: edit, build, test, commit, push and open PRs.
const PR = [...LABEL, 'Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Task'];

/** Never allowed, in any profile: merges go through merge-pr, releases through release.yml. */
export const DISALLOWED = [
	'Bash(gh pr merge:*)',
	'Bash(git push --force:*)',
	'Bash(git push -f:*)',
	'Bash(git push --force-with-lease:*)',
	'Bash(npm publish:*)',
	'Bash(pnpm publish:*)',
	'Bash(pnpm release:*)',
	'Bash(changeset publish:*)',
	'Bash(pnpm changeset publish:*)',
	'Bash(sudo:*)'
];

export const PROFILES = { read: READ, label: LABEL, pr: PR };

/** The `claude_args` for a profile; a dry run always gets `read`. */
export function toolArgs(profile, { dryRun = false } = {}) {
	const tools = PROFILES[dryRun ? 'read' : profile];
	if (!tools) throw new Error(`unknown tool profile "${profile}" (expected read, label or pr)`);
	return `--allowedTools "${tools.join(',')}" --disallowedTools "${DISALLOWED.join(',')}"`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		console.log(toolArgs(process.argv[2], { dryRun: process.argv[3] === 'true' }));
	} catch (error) {
		console.error(`tool-args: ${error.message}`);
		process.exit(1);
	}
}
