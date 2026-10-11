# @xcwds/testing

Test an @xcwds app and its plugins: unit tests with [Vitest](https://vitest.dev) that boot the
real kernel without a browser (like Fastify's `inject()`), and helpers for end-to-end tests with
[Playwright](https://playwright.dev). Nothing here touches the network beyond the local servers
it starts.

```sh
pnpm add -D @xcwds/testing vitest @playwright/test
```

The main entry needs Vitest; `@xcwds/testing/playwright` needs only Playwright. The kit shares
`<App>`'s and the worker's setup and navigation rules through `@xcwds/sveltekit/routes`, so
installing it also brings `@xcwds/sveltekit`, whose peers (`@sveltejs/kit`, `svelte`, `vite`) a
plugin package without pages may warn about; they aren't loaded in unit tests.

## Unit tests

```ts
import { buildTestApp } from '@xcwds/testing';
import timers from '@xcwds/plugin-timers';

const app = await buildTestApp(
	{ plugins: [timers({ prefix: '/utils/timer' })] },
	{ now: new Date('2026-03-01T12:00:00Z'), import: (id) => import(id) }
);
await app.navigate('/utils/timer'); // onNavigate guards, redirects, afterNavigate
app.clock!.jump(5 * 60_000); // the phone slept for 5 minutes
await app.clock!.advance(1000); // the next tick sees the timer has ended
const other = await app.openTab(); // same storage: each gets the other's storage events
await app.close(); // closes every tab and restores the real clock (also done when the test ends)
```

**`buildTestApp(input, options)`** boots the app as `<App>` does, with the same setup and
navigation rules: plugins load, then `onBoot`, `onReady`, the first page's `onNavigate` guards
(`false` can't take the first page back; a redirect is a navigation of its own, whose guards
answer before the first page's `afterNavigate`) and `afterNavigate`. Built inside a test, it
closes when the test finishes (Vitest's `onTestFinished`); built elsewhere (e.g. `beforeAll`),
close it yourself.

- `input` is a whole `xcwds.config` (validated; its name and storage prefix apply) or
  `{ plugins }`, where a plugin is a plugin function, a `[plugin, options]` pair, or a descriptor
  from a plugin package's factory. A descriptor's build entry runs for its routes
  (`app.routes`), then its `./client` entry is registered.
- `storage`: a `memoryStorage()` (the default), any adapter, or a `sharedStorage()` you keep to
  look at.
- `now`: a start time (or a `fakeClock()`) to fake `Date`, `performance` and timers until the app
  closes. `advance(ms)` runs the timers due on the way; `jump(ms)` moves the wall clock (not
  `performance.now()`) without them, as when a phone sleeps, so you can check that timers count
  against end times. Vitest's fake timers are global, so one clock owns them at a time: a
  second app with its own `now`, or `now` in a test that called `vi.useFakeTimers()` itself,
  throws. Apps that should share a clock pass it on (`now: app.clock`).
- `base`: SvelteKit's `paths.base`, for the URLs hooks see. `path`: the first page (`/`).
- `import`: pass `(id) => import(id)` so plugin packages resolve from your test file (pnpm only
  lets a package import its own dependencies). Vitest then transforms them as it does your code.
- `strict` (default `true`): an error reported to `onError` (a failing hook, a redirect loop)
  makes the next operation reject with it: booting, `navigate`, `settle`, `close`. With
  `strict: false` errors are logged and collected in `app.errors`.

The app is the kernel's, plus `navigate(path)` (an app path starting with `/`, without the
base; resolves to `{ path, redirects, cancelled }`), `path` (as navigated to, so a trailing
slash reaches hooks as in the browser), `clock`, `sharedStorage`, `errors`, `openTab()`, `settle()`
(waits for other tabs' `storage` events, which arrive asynchronously as in a browser) and
`close()`.

Decorators reach the test app only from plugins with `encapsulate: false`, as in the page.

**`buildTestWorker(input, options)`** starts the real service worker runtime
(`startWorker()` from `@xcwds/sveltekit/worker`, default strategy included) with each plugin's
`./worker` entry, and lets the test dispatch its events: `fetch(request | path, init)` resolves
to the worker's response, or `undefined` when it leaves the request to the browser (non-GETs,
other origins, paths outside the base); `install()` precaches the `build`, `files`,
`prerendered` and `assets` lists you pass, then runs `onInstall` hooks; `activate()`,
`message(data)`, `skippedWaiting`, `errors` and `close()`. It is strict like `buildTestApp`,
and closes when the test finishes. While it is open, `globalThis.caches` is its in-memory
`caches` (a `MemoryCacheStorage`, with the Cache API's checks) and `fetch()` is answered by the
`network` option (by default every request fails, as offline), so hooks run as they would in
the worker; one test worker can be open at a time. As in the built worker, a request to an
origin other than the app's own, one the plugins declare (`network.origins`) or the
`allowOrigins` option fails without reaching `network`.

## End-to-end tests

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { xcwdsPlaywright } from '@xcwds/testing/playwright';

export default defineConfig(xcwdsPlaywright({ webServer: { command: 'pnpm preview' } }));
```

**`xcwdsPlaywright(config)`** is the setup that kept xcwds.github.io's CI stable: full Chromium
without a GPU process, service workers blocked unless a test opts in with
`test.use({ serviceWorkers: 'allow' })`, `CHROMIUM_PATH` for a Chromium you already have, GitHub
annotations on CI and traces for failures. Your config is merged over it.

```ts
import {
	auditTapTargets,
	gotoHydrated,
	pageVersion,
	serveDeployment,
	serveStatic,
	updateServiceWorker,
	waitForServiceWorker
} from '@xcwds/testing/playwright';

const server = await serveStatic('build', { base: '/sub' }); // like GitHub Pages
await gotoHydrated(page, server.url('/notes')); // waits for <html data-hydrated>
expect(await auditTapTargets(page)).toEqual([]); // every control at least 44×44 px
```

- **`gotoHydrated(page, url)`** navigates and waits until `<App>` has mounted, so typed input
  and clicks aren't lost or doubled.
- **`auditTapTargets(page, { min })`** lists every visible control smaller than 44 px either way.
  Inline text links are exempt, and a checkbox or radio button counts its label.
- **`serveStatic(dir, { base })`** serves a build the way GitHub Pages does: `/page` finds
  `page.html`, unknown paths get `404.html` with a 404, and with a `base` nothing outside it
  exists. Files are read on each request and never from outside `dir`. `requests` lists every
  path and query the server received, e.g. to check that something never reached it.
- **`serveDeployment(dir, { base })`** serves a copy of a build. Each `deployNewVersion(marker)`
  stamps every page with `<meta name="test-version">` and gives the service worker and
  `_app/version.json` a new version, so the browser finds a new worker. `pageVersion(page)` reads
  the stamp (`'original'` before any deploy).
- **`waitForServiceWorker(page)`** waits until a worker controls the page.
  **`updateServiceWorker(page)`** checks for a new one and resolves to `'waiting'`, `'active'` or
  `'none'` once it has installed.

```ts
test.use({ serviceWorkers: 'allow' });

test('a new version waits', async ({ page }) => {
	const deployment = await serveDeployment('build');
	await gotoHydrated(page, deployment.url('/'));
	await waitForServiceWorker(page);
	await deployment.deployNewVersion('v2');
	expect(await updateServiceWorker(page)).toBe('waiting');
	await deployment.close();
});
```
