# Changesets

Run `pnpm changeset` in a PR that changes a published package, and describe the change for its
changelog. Versions and changelogs are cut from these files.

## Releasing

`.github/workflows/release.yml` runs after CI passes on `main`:

- With pending changesets, it opens (or updates) a **Version packages** PR that bumps the versions
  and writes the changelogs (`pnpm version-packages`).
- Once that PR is merged, it builds and publishes every package whose version isn't on npm yet
  (`pnpm release`, which runs `changeset publish`), with provenance, and tags the release.

Every release also republishes `@xcwds/create`, which bakes the other packages' versions into
the apps it generates: `pnpm version-packages` adds a patch changeset for it when none of the
pending ones names it ([#54](https://github.com/xcwds/xcwds/issues/54)).

When a package's next version leaves the range another package peers on it with (a core or
sveltekit minor, on 0.x), that package has to be released again with the new range, which is a
breaking change for it. `pnpm version-packages` gives it that bump itself
([#229](https://github.com/xcwds/xcwds/issues/229)): `scripts/peer-dependent-changesets.js` writes
`generated-peer-<name>.md` changesets giving each such package a minor (a major from 1.0), following
dependents of dependents (camera → qr, shell → settings), and `scripts/check-release-plan.js` fails
the run, naming the packages, if `changeset version` still releases a 0.x package as 1.0.0 that no
changeset asked a major for, or a peer bump as anything less than a breaking release. A failed run
leaves the old Version packages PR as it was. `pnpm changeset status` doesn't run the script, so it
under-reports those bumps: to preview a release, run `pnpm version-packages` on a scratch copy of
`main` (a worktree) instead.

Packages marked `"private": true` (the examples and the docs site) are never published. The
Version packages PR is opened with the workflow's own token, which doesn't start CI on it; CI runs
on `main` after the merge, before the publish.

### Turning it on

The workflow does nothing until the repository variable `NPM_RELEASE` is `true`. Before setting it:

1. On npmjs.com, own the `@xcwds` organization (scope).
2. Give the workflow a way to publish, either:
   - **Trusted publishing** (no secret): for each package, add a trusted publisher on npmjs.com
     with owner `xcwds`, repository `xcwds`, workflow `release.yml` and environment `npm`. A package
     must exist on npm before it can have one, so the first publish of each needs a token.
   - **A token**: an npm granular access token with read and write access to `@xcwds`, saved as the
     `NPM_TOKEN` secret of the `npm` environment (or of the repository).
3. In Settings → Actions → General, allow GitHub Actions to create pull requests.
4. Optionally, add required reviewers to the `npm` environment. Every run then waits for approval,
   including the ones that only update the Version packages PR.

Run it by hand from the Actions tab (Release → Run workflow) on `main` at any time. With a token,
each run checks it with `npm whoami` first and warns when npm refuses it (granular tokens expire
after 7 days by default), so an expired token shows up before a publish fails.

`pnpm version-packages` fails when there are no pending changesets (changesets 3's
`changeset version` exits 1 then); the workflow only runs it when there are some.

## When core or sveltekit gets a minor

The plugins, `@xcwds/sveltekit` and `@xcwds/testing` peer on `@xcwds/core` (and the plugins on
`@xcwds/sveltekit`) with a `^` range. On 0.x a minor leaves that range, so every peer dependent
needs a release with the new range, which is breaking for it. Changesets 3 makes those patches on
its own (changesets 2 made them 1.0.0, which is why the Version packages PR used to be hand-edited,
[#90](https://github.com/xcwds/xcwds/issues/90)); the script above turns them into minors, and the
check fails the run if one slips through. To go to 1.0 on purpose, add a changeset asking for
`major`.

The plugins' `core` ranges (`CORE` in each `options.ts`) already follow core's minor:
`pnpm version-packages` runs `scripts/sync-core-version.js`.
