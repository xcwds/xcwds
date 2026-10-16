# Agent guide

How AI coding agents (Claude Code and others) should work in this repo. The files below are the source of truth. This page points to them and adds the gotchas that don't fit anywhere else. If this page and a repo file disagree, the repo file wins. Fix this page when you notice a mismatch.

## Read these first

| File                                                             | What it covers                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`CLAUDE.md`](CLAUDE.md)                                         | The agent rules: pre-push checks, PR and merge flow, kernel limits, docs duties                     |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                             | Setup, every script, Playwright, workflow pinning, the Node 22.18 job                               |
| [`docs/rfc/0001-architecture.md`](docs/rfc/0001-architecture.md) | The design decisions (1–14). Follow them, and change the RFC in the same PR when a decision changes |
| [`.changeset/README.md`](.changeset/README.md)                   | Changesets, the release workflow and the 1.0.0 hand edit                                            |
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

## Releases and the 1.0.0 trap

The plugins, `sveltekit` and `testing` peer on `@xcwds/core` with a `^0.x` range. A core (or sveltekit) minor leaves that range, and changesets then bumps every peer dependent to **1.0.0**. The owner keeps everything on 0.x, so the Version packages PR is hand-edited before merging: each would-be 1.0.0 goes to the next minor in `package.json`, `CHANGELOG.md` headings ("Major" → "Minor"), the "Updated dependencies" lines, and the PR description. The exact steps are in [`.changeset/README.md`](.changeset/README.md#when-core-or-sveltekit-gets-a-minor) ([#90](https://github.com/xcwds/xcwds/issues/90), [#137](https://github.com/xcwds/xcwds/issues/137)).

- The bot rewrites the Version packages PR whenever something merges to `main`, which wipes the edits. Make them last, right before the merge.
- Check the latest Release run before reviewing a Version packages PR. Runs have failed silently before ([#176](https://github.com/xcwds/xcwds/issues/176), [#177](https://github.com/xcwds/xcwds/issues/177)).
- Preview a release with `pnpm changeset status --verbose`, or a full `pnpm version-packages` on a throwaway copy of `main`.

## Package gotchas

- Every `packages/plugin-*` needs `src/options.ts` exporting `CORE` (for example `export const CORE = '^0.4.0';`). `scripts/sync-core-version.js` moves it along with core's minor, and fails without it.
- Every plugin `index.ts`, `client.ts` and `worker.ts` must call `definePlugin` with `core: CORE`. `packages/core/src/first-party.test.ts` checks this.
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
