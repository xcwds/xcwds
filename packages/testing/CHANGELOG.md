# @xcwds/testing

## 0.2.0

### Patch Changes

- 378f9d5: `@xcwds/core` is now a peer dependency, so an app always has one kernel, even after core moves
  to a new minor before a plugin is re-released. Apps already depend on `@xcwds/core` directly (the
  starter adds it). Every first-party plugin also declares `core` in its metadata, so an app on an
  incompatible core gets `XCWDS_ERR_PLUGIN_VERSION_MISMATCH` at boot instead of a broken page.
- 54329f6: The service worker can no longer contact origins the app doesn't declare. The page's CSP doesn't reach the worker, so the generated worker now installs a guard (`@xcwds/sveltekit/guard`) before any plugin's worker code runs: `fetch`, `WebSocket`, `EventSource`, `WebTransport`, `Cache#add`/`addAll` and background fetches refuse any origin other than the app's own, the ones plugins declare and `privacy.allowOrigins`, with an error naming it (#55). `buildTestWorker` applies the same rule, with an `allowOrigins` option.
- Updated dependencies [eb3be18]
- Updated dependencies [da6e2df]
- Updated dependencies [378f9d5]
- Updated dependencies [8163df3]
- Updated dependencies [61623c5]
- Updated dependencies [9894dfd]
- Updated dependencies [6b25d5a]
- Updated dependencies [54329f6]
  - @xcwds/sveltekit@0.2.0
  - @xcwds/core@0.2.0

## 0.1.0

### Minor Changes

- 28d0b17: The test kit. For Vitest: `buildTestApp()` boots an app's plugins (functions, pairs, or
  descriptors loaded from their packages' entries, with their build routes) on in-memory storage,
  with a fake wall clock, simulated tabs that get each other's `storage` events, and `navigate()`
  running the route hooks with the shell's rules; `buildTestWorker()` runs worker hooks against a
  `Request` with in-memory `caches` and a fake network. Both fail on errors reported to
  `onError` unless `strict: false`, and close when the test finishes. For Playwright (`@xcwds/testing/playwright`): `gotoHydrated`,
  `auditTapTargets`, a GitHub Pages-like static server, `serveDeployment()` for fake new versions,
  service-worker helpers and the `xcwdsPlaywright()` config preset.
- e8d705f: `buildTestWorker()` runs the real service worker runtime, default strategy included: pass the
  `build`, `files`, `prerendered` and `assets` lists to precache, dispatch `fetch`, `install`,
  `activate` and `message` events, and read `skippedWaiting`. A test that throws after an error
  was reported to `onError` now fails with that error.
- d1dd001: A test app's shared storage is now `sharedStorage` (was `shared`), so plugins can decorate
  `app.shared`. `serveStatic()` and `serveDeployment()` list the `requests` they received.

### Patch Changes

- 1924274: `storage.appName` sets the name backups carry and must carry to import (default: `brand.name`), so
  an app moving onto @xcwds keeps importing the backups it made before.
- 1d8bbc1: The repository moved to [xcwds/xcwds](https://github.com/xcwds/xcwds): package metadata, READMEs and
  the README of apps made with `npm create @xcwds` link there.
- c7b941f: `auditTapTargets` counts a radio button's label as its hit area, as it already did for checkboxes.
- Updated dependencies [94e846b]
- Updated dependencies [9cb54f8]
- Updated dependencies [71e1cf1]
- Updated dependencies [1924274]
- Updated dependencies [1924274]
- Updated dependencies [1924274]
- Updated dependencies [b03ad2e]
- Updated dependencies [1d8bbc1]
- Updated dependencies [8c78037]
- Updated dependencies [94e846b]
- Updated dependencies [d1dd001]
- Updated dependencies [058e876]
- Updated dependencies [28d0b17]
- Updated dependencies [e8d705f]
  - @xcwds/core@0.1.0
  - @xcwds/sveltekit@0.1.0
