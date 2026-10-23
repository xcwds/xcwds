# Agent guide

How AI coding agents (Claude Code and others) should work in this repo. The files below are the source of truth. This page points to them and adds the gotchas that don't fit anywhere else. If this page and a repo file disagree, the repo file wins. Fix this page when you notice a mismatch.

## Read these first

| File                                                             | What it covers                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`CLAUDE.md`](CLAUDE.md)                                         | The agent rules: pre-push checks, PR and merge flow, kernel limits, docs duties                     |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                             | Setup, every script, Playwright, workflow pinning, the Node 22.18 job                               |
| [`docs/rfc/0001-architecture.md`](docs/rfc/0001-architecture.md) | The design decisions (1–14). Follow them, and change the RFC in the same PR when a decision changes |
| [`.changeset/README.md`](.changeset/README.md)                   | Changesets, the release workflow and peer-dependent bumps                                           |
| [`.github/labels.md`](.github/labels.md)                         | Issue labels (same file in xcwds.github.io; keep the two identical)                                 |
| [`docs/`](docs)                                                  | User-facing guides: getting started, concepts, plugin guide, privacy, ecosystem                     |

## What's where

- `packages/*`: published under `@xcwds` (`core`, `sveltekit`, `testing`, `create`, `plugin-*`).
- `examples/*`: test apps (`minimal`, `plugin-hello`, `plugin-tally`, the tutorial plugin). Never published.
- `site/`: the docs site at [docs.xcwds.com](https://docs.xcwds.com), built with xcwds itself and deployed by `docs.yml` after CI passes on `main`.
- `scripts/`: release helpers (`sync-core-version.js`, `copy-license.js`).
- The app that dogfoods the framework is [xcwds/xcwds.github.io](https://github.com/xcwds/xcwds.github.io). It installs `@xcwds/*` from npm, so a framework change reaches it only after a release. It has its own `CLAUDE.md`.

## Hard rules

- **Never publish.** Don't run `npm publish`, `changeset publish` or `pnpm release`. Releases go through `.github/workflows/release.yml`.
- **Merging a "Version packages" PR publishes to npm.** Never merge one, or push to its `changeset-release/main` branch, without the owner's explicit go-ahead. A publish can't be undone and version numbers can't be reused.
- **Never phone home.** No telemetry and no network calls in any package unless a plugin declares them (RFC decision 10; the build scan and CSP enforce it).
- **The kernel stays framework-agnostic.** `@xcwds/core` has no Svelte or DOM-framework imports and no browser globals at import time, because client code is imported during prerender.
- **Plugin options must be JSON-serialisable** (RFC decision 1).
- **Never skip, disable or quarantine a test** to get CI green.

## Workflow

1. Branch from `main` as `claude/<topic>` (routine work uses `claude/issue-<repo>-<n>`).
2. Make the change. Add a changeset (`pnpm changeset`) for any change to a published package.
3. Run the pre-push checks from `CLAUDE.md`:
   ```sh
   pnpm build && pnpm check && pnpm lint && pnpm publint && pnpm test:unit --run && pnpm test:e2e
   ```
   Add `pnpm test:starter` when a generated app could change (`packages/create`, or any package it uses).
4. Open a PR against `main` with `Closes #n` for each issue it closes.
5. Review it adversarially (what's broken, unsafe or missing, not just style) and post that review on GitHub. Fix, push, and review again, for at most 3 rounds.
6. Squash-merge once CI is green and the review is clean, unless the owner says not to. Never merge a Version packages PR this way (see above).

## Releases and peer dependents

The plugins, `sveltekit` and `testing` peer on `@xcwds/core` (and the plugins on `sveltekit`, some on `plugin-shell` or `plugin-camera`) with a `^0.x` range. A minor of a peer leaves that range, so its dependents must be released again as a breaking change, which the owner wants as the next **minor** on 0.x, never 1.0.0. `pnpm version-packages` writes those minors as `generated-peer-*.md` changesets (`scripts/peer-dependent-changesets.js`) and then checks the result (`scripts/check-release-plan.js`), failing on any unasked 1.0.0 or a peer bump released as a patch ([#229](https://github.com/xcwds/xcwds/issues/229)). Since changesets 3 ([#230](https://github.com/xcwds/xcwds/issues/230)) the Version packages PR needs no hand edits; the old 1.0.0 hand edit ([#90](https://github.com/xcwds/xcwds/issues/90)) is gone.

- Check the latest Release run before reviewing a Version packages PR. Runs have failed silently before ([#176](https://github.com/xcwds/xcwds/issues/176), [#177](https://github.com/xcwds/xcwds/issues/177)).
- Preview a release with a full `pnpm version-packages` on a throwaway copy of `main`; `pnpm changeset status` doesn't run the peer-dependent script, so it under-reports bumps.

## Package gotchas

- Every `packages/plugin-*` needs `src/options.ts` exporting `CORE`, set to core's current range (for example `export const CORE = '^0.4.0';`). Don't pick it by hand: `pnpm version-packages` runs `scripts/sync-core-version.js`, which moves it (and the copies in `examples/plugin-tally` and `docs/plugin-guide.md`) along with core's minor, and fails if a plugin lacks the file.
- Each `definePlugin` call in a plugin's `index.ts`, `client.ts` or `worker.ts` (whichever it has) passes `core: CORE`. `packages/core/src/first-party.test.ts` checks both rules.
- Unreleased packages are `"private": true` and listed in `ignore` in [`.changeset/config.json`](.changeset/config.json). A changeset that names an ignored package breaks the release run. When a package ships, remove both, and add it to `docs/ecosystem.md` and `PACKAGES` in `site/src/lib/server/pages.ts`.
- Changing a file in `examples/plugin-tally` means copying it into `docs/plugin-guide.md`. A site unit test compares them. Renovate leaves that example's `package.json` alone, so bump it by hand with the guide.
- Docs use relative file links so they work on GitHub and on the docs site alike.

## Formatting and config

- `pnpm lint` runs `prettier --check .`, which covers JSON. `renovate.json` must be Prettier-formatted or lint fails. Run `pnpm format` after editing it.
- Workflows pin every action to a commit SHA with the version in a comment (`uses: actions/checkout@<sha> # v7.0.1`), and each job gets only the `permissions` it needs.
- Renovate groups minor and patch updates into one PR; majors stay separate.

## Cloud containers

- Don't run `playwright install`. Point `CHROMIUM_PATH` at the Chromium that's already there:
  ```sh
  export CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)
  ```
- `pnpm test:starter` leaves an app in `examples/starter`. Delete it before `pnpm install` and never commit a lockfile that mentions it. `git checkout pnpm-lock.yaml` afterwards also drops your own new dependencies, so run `pnpm install` again if you added any.
- CI's Chromium sometimes crashes with SEGV ([#91](https://github.com/xcwds/xcwds/issues/91)). One re-run settles it. A second failure is real.

## Issues and labels

- Label new issues with one type and one priority from `.github/labels.md`. Never invent labels.
- Automated work skips `needs decision` and `tracking` issues.
- People-only labels (`human requested`, `refinement requested`, `answered in comments`, `branding`, …) are never added by agents. The two exceptions they may remove are described in `labels.md`.

## Agent workflows

The routines that run as scheduled tasks today are moving to GitHub Actions ([#199](https://github.com/xcwds/xcwds/issues/199)). Everything runs on one reusable workflow; each schedule waits for its `AGENT_<ROUTINE>=on` variable.

- [`.github/workflows/agent.yml`](.github/workflows/agent.yml) (`workflow_call`): checks out the repos side by side with full history, starts the token helper, installs dependencies and Playwright's Chromium, takes away sudo and Docker, then runs `anthropics/claude-code-action` with `.github/agents/common.md` plus the routine's prompt. Inputs: `prompt`, `context`, `repos` (`xcwds`, `xcwds.github.io` or `both`), `tools` (`read`, `label` or `pr`), `dry_run` (forces `read`), `timeout`, `max_turns`, `agents_ref`, `reply` (posts a "Working on it" reply to the triggering issue, PR or review comment as soon as the run starts, then replaces it with the agent's final message, or a failure note with the run's link; so a run on the `read` profile can answer too). Callers in xcwds.github.io use it as `xcwds/xcwds/.github/workflows/agent.yml@main`.
- Routines take their prompts and scripts from xcwds/xcwds `main` (the `agents_ref` default), never from a PR's branch; only the smoke test passes its own commit, to test a branch. The scripts are copied to a root-owned `/opt/xcwds-agent/bin` so a run can't change them.
- [`.github/agents/bin/`](.github/agents/bin): `token-helper.mjs` (runs as root with the app's key, serves installation tokens on a socket; they last an hour and runs can be longer), `agent-token`, the `gh` wrapper and git credential helper that ask it for a token on every call, `merge-pr` (the only way a run merges: it refuses Version packages PRs, authors other than the bot, Renovate or the owner, red or pending CI, drafts and conflicts) and `tool-args.mjs` (the tool profiles). Their unit tests are in `.github/agents/test/` (the `agents` vitest project).
- Tool profiles are a guardrail, not a sandbox: the app's tokens can do more. Branch rulesets on `main` and `changeset-release/main` (owner step 3) are what makes "never push to `main`" hold.
- A PR from a fork gets its base branch only, no installs and the `read` profile, because `issue_comment` runs have the secrets.
- [`agent-mention.yml`](.github/workflows/agent-mention.yml): `@claude` in an issue (opened), a comment, a PR review or a review comment runs [`mention.md`](.github/agents/mention.md) on the `pr` profile with `reply`. Its job-level `if` skips bots and anyone without write access (the action checks write access again), and review events on fork PRs, which get no secrets. It calls `agent.yml` at `@main`, so a review on a PR never runs the branch's copy. It uses the action's agent mode, not its tag mode: tag mode checks out and configures git in the workspace root, which here holds one folder per repo.
- [`agent-labeling.yml`](.github/workflows/agent-labeling.yml) runs [`labeling.md`](.github/agents/labeling.md) on the `label` profile over both repos: on Sun, Tue and Fri at 18:47 UTC every open issue plus at most 2 refinements, and for one issue when the owner adds `refinement requested` or `answered in comments` to it (here, or in xcwds.github.io through its caller, which uses it by `workflow_call`). Both wait for the variable `AGENT_LABELING=on`, set at cutover once the scheduled task is off. By hand (Run workflow) it takes an optional `issue` (`owner/repo#n`) and is a dry run unless `dry_run` is turned off. The `label` profile can also push `claude/labels-*` branches and open PRs, for changes to `.github/labels.md`, which the owner merges.
- [`agent-renovate.yml`](.github/workflows/agent-renovate.yml) runs [`renovate.md`](.github/agents/renovate.md) on the `pr` profile over both repos, daily at 13:56 UTC once the variable `AGENT_RENOVATE=on` is set: it leaves every open Renovate PR merged (through `merge-pr`, lockfile PRs one at a time per repo, each refreshed on the new `main`) or closed with a reason. It may push small fixes to `renovate/*` branches, the one exception to "never push to a branch the bot didn't create". By hand (Run workflow) it takes `repo` (`both`, `xcwds` or `xcwds.github.io`) and an optional `pr` number (needs one repo), and is a dry run unless `dry_run` is turned off. All its runs share one concurrency group, so two never merge lockfile PRs side by side.
- [`agent-issue-to-pr.yml`](.github/workflows/agent-issue-to-pr.yml) runs [`issue-to-pr.md`](.github/agents/issue-to-pr.md) on the `pr` profile over both repos, at 03:13, 13:13 and 19:13 UTC once the variable `AGENT_ISSUE_TO_PR=on` is set: one issue per run. It first finishes the bot's previous open `claude/issue-*` PR; otherwise it picks the top open issue by `priority: …` label (then smaller, then older), skipping `tracking`, `needs decision`, issues with an open PR by anyone, and anything that needs the owner (publishing, releases, secrets, settings, the release workflow). It builds on `claude/issue-<repo>-<n>`, runs the pre-push checks and e2e, posts a comment review with inline comments, fixes at most 3 rounds, waits for CI in the job and merges through `merge-pr`. It never merges a PR that changes workflows or `.github/agents/`: the owner does. By hand (Run workflow) it takes an optional `issue` (`owner/repo#n`) and is a dry run unless `dry_run` is turned off. It reports on the Issue to PR run-log issue.
- [`agent-followup.yml`](.github/workflows/agent-followup.yml) follows up on the bot's own PRs, as the cloud sessions do when a PR event wakes them: a failed `CI` run (`workflow_run`) on an open PR the bot opened on a `claude/` branch, or the owner's review on one (requested changes or commented), runs [`followup.md`](.github/agents/followup.md) on the `pr` profile, one run per PR at a time (`agent-pr-<repo>-<n>`). It fixes red CI or says why it isn't the PR's, answers review threads, re-requests the owner's review after requested changes, and otherwise merges through `merge-pr` once clean and green. A gate job ([`followup-gate.mjs`](.github/agents/bin/followup-gate.mjs), on the workflow's own read-only token) skips reviews that tag `@claude` anywhere (the mention workflow takes those), stale failures, Renovate's and anyone else's PRs, and everything while an Issue to PR run is in progress. Its fix commits carry an `Agent-Followup:` trailer; after 3 since the owner's last activity on the PR it comments what's left and stops. Every review comment arrives as a submitted review, so there's no `pull_request_review_comment` trigger. xcwds.github.io's caller runs it by `workflow_call` and must grant `actions: read` and `pull-requests: read`.
- [`agent-smoke.yml`](.github/workflows/agent-smoke.yml) is a manual dry run that proves the setup: bot identity, `gh` in both repos and a token refresh.
- Run logs: routines report as comments on [#232](https://github.com/xcwds/xcwds/issues/232) (Issue to PR), [#233](https://github.com/xcwds/xcwds/issues/233) (Renovate) and [#234](https://github.com/xcwds/xcwds/issues/234) (labeling), never in new issues.
- Each scheduled caller sets its own concurrency group (`agent-<routine>`, `cancel-in-progress: false`) and a plain UTC cron. `@claude` mentions use no group, since GitHub keeps only one pending run per group.

### Owner setup

1. Create a GitHub App under your account (Settings → Developer settings → GitHub Apps), e.g. "xcwds-agent", with no webhook. Repository permissions: Contents, Pull requests and Issues read and write; Workflows read and write; Actions read and write; Checks, Commit statuses and Metadata read. Install it on xcwds/xcwds and xcwds/xcwds.github.io only.
2. In **both** repos, under Settings → Secrets and variables → Actions, add:
   - secret `AGENT_APP_PRIVATE_KEY` (the app's private key) and secret `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`; runs count against your plan's usage limits);
   - variable `AGENT_APP_ID` (the app's client ID);
   - variables `AGENT_LOG_ISSUE_TO_PR=232`, `AGENT_LOG_RENOVATE=233` and `AGENT_LOG_LABELING=234`;
   - optionally, variable `AGENT_MODEL` to pick the model (`--model`).
3. Recommended: in both repos, add a branch ruleset on `main` and `changeset-release/main` (Settings → Rules) that blocks force pushes and direct pushes for everyone but you. Put yourself on the bypass list, plus GitHub Actions for `changeset-release/main`. Check first that it doesn't block how you push today.
4. Run **Agent smoke test** (Actions → Agent smoke test → Run workflow) and check that its summary ends with "Smoke test passed".
