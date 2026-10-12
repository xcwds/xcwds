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

Run it by hand from the Actions tab (Release → Run workflow) on `main` at any time.

## When core or sveltekit gets a minor

The plugins, `@xcwds/sveltekit` and `@xcwds/testing` peer on `@xcwds/core` (and the plugins on
`@xcwds/sveltekit`) with a `^` range. On 0.x a minor leaves that range, and changesets then bumps
every peer dependent to a **major**: a core 0.2.0 would release them all as 1.0.0. Keep them on
0.x by fixing the Version packages PR by hand before merging it ([#90](https://github.com/xcwds/xcwds/issues/90)):

1. Preview the plan on `main` with `pnpm changeset status --verbose`. Any package "bumped at major"
   that no changeset asked to be major needs the fix.
2. Fix the PR as the last step before merging, since the workflow rewrites it on every push to
   `main`. On its branch (`changeset-release/main`), for each such package:
   - in its `package.json`, set `version` to the next minor (`1.0.0` → `0.2.0` when it was
     `0.1.x`);
   - in its `CHANGELOG.md`, change the new heading to that version and `### Major Changes` to
     `### Minor Changes`.
3. Check that no `1.0.0` is left (`git grep -n '"version": "1.0.0"' -- 'packages/*/package.json'`),
   push, and merge. CI runs on `main` before anything is published.

The plugins' `core` ranges (`CORE` in each `options.ts`) already follow core's minor:
`pnpm version-packages` runs `scripts/sync-core-version.js`.
