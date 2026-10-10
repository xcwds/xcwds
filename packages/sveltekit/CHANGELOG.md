# @xcwds/sveltekit

## 0.1.0

### Minor Changes

- 1924274: Routes can be `split` wide: narrow until wide screens, then room for two columns (the shell's
  `page-split` utility). Tools take a `width`, and the settings page takes `width` and `emoji: ''`
  (no emoji in its header).
- 1924274: `storage.appName` sets the name backups carry and must carry to import (default: `brand.name`), so
  an app moving onto @xcwds keeps importing the backups it made before.
- b03ad2e: Never phone home, enforced: plugins' `network` metadata is checked when they load
  (`XCWDS_ERR_PLUGIN_META`), the build fails on any origin in the built site that no plugin
  declares and `privacy.allowOrigins` doesn't list (naming the plugin), the CSP allows only the
  declared origins, `privacy.allowOrigins` also takes `wss:` origins, development builds warn when
  a query string carries saved data (`savedDataInQuery`), and the settings page has a Privacy
  section listing what each plugin contacts.
- 8c78037: `brand` (the app's name and tagline) and `appPath(pathname)` (a pathname without the base path,
  never relative while prerendering) for page chrome.
- 94e846b: The SvelteKit integration: `withXcwds()` for svelte.config.js (config loading, build hooks,
  adapter-static with a 404.html fallback, prerender entries, a hash-mode CSP), the `xcwds()` Vite
  plugin (plugin client entries, manifest and icons), `handle` and `init` hooks (pre-paint script
  and head tags), a service worker runtime with baseline offline support, `<App>`, `useApp()`,
  Svelte 5 `persist()` and reactive `settings`, and a route registry. Honours `paths.base`.
- 058e876: Routes can be marked `private`, for personal pages plugins should keep out of what they share or
  list.
- e8d705f: The service worker runtime decorates `app.worker` (version, base, cache name, `skipWaiting()`
  and a cache `policy` that worker plugins adjust: extra precache paths, exclusions, the offline
  fallback page, runtime caching), and exports its event and scope types.

### Patch Changes

- 1924274: `<html data-hydrated>` is set once the app has booted, so tests that wait for it never act before
  plugins follow the browser's events. `<TimerAlert>` no longer re-renders itself in a loop while a
  timer rings, and takes an `openLabel` for its Open link. The config also loads in a fresh checkout, before `svelte-kit sync` has written the
  `.svelte-kit/tsconfig.json` an app's tsconfig extends.
- 1d8bbc1: The repository moved to [xcwds/xcwds](https://github.com/xcwds/xcwds): package metadata, READMEs and
  the README of apps made with `npm create @xcwds` link there.
- d1dd001: `brand` reads the config lazily, so a plugin's client entry can import components that use it.
- 28d0b17: `<App>` marks `<html data-hydrated>` once mounted. `@xcwds/sveltekit/routes` exports the
  framework-free core `<App>`, the service worker and `@xcwds/testing` share: the route
  registry, `setupApp`, `routeOf`, `askGuards`, `decide` and `workerPath`.
- Updated dependencies [94e846b]
- Updated dependencies [9cb54f8]
- Updated dependencies [71e1cf1]
- Updated dependencies [1924274]
- Updated dependencies [b03ad2e]
- Updated dependencies [1d8bbc1]
  - @xcwds/core@0.1.0
