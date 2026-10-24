# @xcwds/plugin-offline

Offline support for an @xcwds app on [`@xcwds/sveltekit`](../sveltekit). The integration's
service worker already precaches the build and serves it from this version's cache first; this
plugin tunes that strategy, keeps pages and files that weren't precached once they load, and
tells the page when the browser is offline.

```ts
// xcwds.config.ts
import { defineConfig } from '@xcwds/core';
import offline from '@xcwds/plugin-offline';

export default defineConfig({
	brand,
	plugins: [offline({ exclude: ['/videos/**'] })]
});
```

```svelte
<!-- src/routes/+layout.svelte, inside <App> -->
<script lang="ts">
	import OfflineNotice from '@xcwds/plugin-offline/OfflineNotice.svelte';
</script>

<OfflineNotice label="Offline · everything still works" />
```

## Options

All paths are app paths, without the base path.

| Option           | Default       | What it does                                                                                                                                                                                         |
| ---------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `precache`       | `[]`          | Extra paths to precache on install, beside everything the build emits.                                                                                                                               |
| `exclude`        | `[]`          | Globs never precached or cached at runtime (`*` within a segment, `**` across segments). They still load from the network.                                                                           |
| `fallback`       | `'/404.html'` | The page offline navigations get when nothing is cached for them. The default boots the app, which renders its error page.                                                                           |
| `runtimeCaching` | `true`        | Keep same-origin `200` responses without a query string that weren't precached, so they work offline later. They live in this version's cache, so an update drops them until they load again online. |
| `byApp`          | `false`       | Keep only the apps people turned on offline (see below). Needs `@xcwds/plugin-tools` with `apps`.                                                                                                    |

## Only the apps that are on

With `byApp: true`, the pages of [`@xcwds/plugin-tools`](../plugin-tools)' apps (their tools'
pages and `routes`) are left out of the install precache, so people who use two apps don't
download all of them on install and on every update. Everything else, the build's scripts and
styles included, is precached as before.

- A first install caches the pages of the apps that start on (`default` not false).
- The page tells the worker which apps are on when it boots, whenever one is turned on or off,
  and when a new worker takes over. The worker saves that list in a cache of its own (a worker
  can't read the page's storage), downloads the pages of apps turned on and deletes those of
  apps turned off.
- An update precaches the shared pages plus the pages of the apps in the saved list, and fails
  to install (keeping the old version) rather than leave one of them out, so an update never
  makes an app you use stop working offline. The first update to a version with `byApp` has no
  saved list yet, so it keeps every app, as the version before did. Apps turned on or off while
  an update waits reach the new version when it takes over.
- A page of an app that's off still opens online, and runtime caching keeps it as for any page
  that wasn't precached.
- A page downloaded when an app is turned on comes from the server as it is then: if a newer
  version is already deployed, that copy belongs to it until the update is applied.

## In the page

`app.network` holds the browser's online state: `online` and `subscribe(listener)`, which calls
the listener now and on every change and returns a function that stops it. `<OfflineNotice>`
renders it as a `role="status"` notice; restyle it with `--xcwds-offline-bg` and
`--xcwds-offline-fg`, or render your own from `app.network`.

## Testing

`buildTestWorker` from `@xcwds/testing` runs the real worker with this plugin; pass the build
lists to precache and a `network` to answer what isn't cached. The e2e tests in
[`examples/minimal`](../../examples/minimal/e2e/plugins.test.ts) load the app once, go offline,
and check every page, an unknown URL and the notice.
