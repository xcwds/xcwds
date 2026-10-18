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
