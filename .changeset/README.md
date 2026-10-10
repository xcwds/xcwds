# Changesets

Run `pnpm changeset` in a PR that changes a published package, and describe the change for its
changelog. Versions and changelogs are cut from these files.

## Releasing

`.github/workflows/release.yml` runs after CI passes on `main`:

- With pending changesets, it opens (or updates) a **Version packages** PR that bumps the versions
  and writes the changelogs (`pnpm version-packages`).
- Once that PR is merged, it builds and publishes every package whose version isn't on npm yet
  (`pnpm release`, which runs `changeset publish`), with provenance, and tags the release.

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
