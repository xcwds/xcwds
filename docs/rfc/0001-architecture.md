# RFC 0001: Architecture

- Status: accepted
- Issue: [#2](https://github.com/xcwds/xcwds/issues/2)
- Spikes: [`examples/minimal`](../../examples/minimal) and
  [`examples/plugin-hello`](../../examples/plugin-hello), now built on `@xcwds/sveltekit` (#10)
  and tested by [`e2e/app.test.ts`](../../examples/minimal/e2e/app.test.ts), at the root and
  under a base path

@xcwds is a framework for making installable, offline-first PWAs from a config file and a list
of plugins. It generalises what [xcwds.github.io](https://github.com/xcwds/xcwds.github.io) built
by hand, and copies [Fastify](https://fastify.dev)'s shape: a small core whose features all come
from encapsulated plugins with hooks, decorators and declared dependencies.

This RFC records the decisions every later issue builds on. Where it says "the kernel", it means
`@xcwds/core`; "the integration" is `@xcwds/sveltekit` (#10).

## Fastify, mapped

| Fastify                                                      | @xcwds                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `fastify.register(plugin, opts)`, child contexts             | `app.register(plugin, opts)`; each plugin gets a child context                         |
| `fastify-plugin` (`skip-override`)                           | `definePlugin(fn, { encapsulate: false })`                                             |
| Plugin metadata: `name`, `dependencies`, `decorators`, range | Same, with `core` as the semver range of `@xcwds/core`, plus `network` (#22)           |
| avvio: ordered async boot, `after`, `ready`, `pluginTimeout` | Same semantics: depth-first load, `await app.ready()`, a 10 s per-plugin timeout       |
| Hooks: `onRequest`, `preHandler`, `onError`, `onReady`, ...  | Build, runtime and service-worker hook families (#5)                                   |
| `decorate`, `hasDecorator`                                   | Same; components read them with `useApp()`                                             |
| Route `prefix`                                               | `prefix` scopes a plugin's routes and route-bound hooks to a path                      |
| JSON-schema validation                                       | Validators on config, plugin options, settings fields and saved data                   |
| `fastify.log`, `setErrorHandler`                             | `app.log` (local console only) and the `onError` hook                                  |
| Declaration merging on `FastifyInstance`                     | Declaration merging on `App`, `Settings`                                               |
| `fastify.inject()`                                           | `@xcwds/testing` (#21)                                                                 |
| `@fastify/*`, `fastify-*`                                    | `@xcwds/plugin-*` first-party, `xcwds-plugin-*` community (npm keyword `xcwds-plugin`) |
| `create-fastify`                                             | `npm create @xcwds` (#23)                                                              |

## Decisions

### 1. Plugins reach three environments through descriptors and entry points

A server plugin runs in one process. A PWA plugin may need code in three places: the build
(Node, via Vite), the page (the browser, but also Node while SvelteKit prerenders) and the
service worker.

**Decision.** A plugin package exposes up to three entry points as package exports:

| Export     | Runs in                         | Holds                                                |
| ---------- | ------------------------------- | ---------------------------------------------------- |
| `.`        | Node, while loading the config  | The plugin factory and its `build` hooks             |
| `./client` | The page, and Node at prerender | The runtime plugin (`definePlugin(...)`), components |
| `./worker` | The service worker              | The worker plugin (`onFetch`, `onInstall`, ...)      |

Calling a plugin in `xcwds.config.ts` returns a **descriptor**: the package name plus its
options. The integration turns the descriptor list into generated imports of each package's
`./client` and `./worker`, so build-only code never reaches the bundle and page code never
reaches the worker.

```ts
// xcwds.config.ts
export default defineConfig({
	brand: { name: 'Pocketbox' },
	plugins: [timers({ prefix: '/utils/timer' })] // → { name: '@xcwds/plugin-timers', options: {...} }
});
```

**Consequence.** Options cross from Node into the page and the worker, so they must be
JSON-serialisable. The config validator rejects anything else (a function, a class instance,
`undefined` inside an array) with the plugin's name. A plugin needing code from the app takes a
module path as an option and imports it from its own entry.

Each entry is a kernel plugin (`definePlugin(...)`): `./client` and `./worker` as their default
export, and the `.` entry as a named `build` export beside the factory. The integration registers
each with the plugin's options in its own app (build, page, worker), so build hooks and routes
(`app.route()`) are added in Node, and runtime and worker hooks where they run.

**Spike.** Test 1: `hello({ greeting: 'hi' })` in [`xcwds.config.ts`](../../examples/minimal/xcwds.config.ts)
becomes `virtual:xcwds/client`, whose `onBoot` sets `data-hello="hi"` in the browser. The same
module is imported at prerender without error, so client entries must not touch browser
globals at import time (`onBoot` and later hooks only run in the browser). Their plugin
functions do run at prerender, so pages render with their decorators and settings fields.

The integration loads `xcwds.config.ts` with Vite's `runnerImport` (Vite ≥ 6.1), so TypeScript
configs need no separate compiler.

### 2. Plugin pages are thin route files

SvelteKit only has filesystem routes; a package can't add one.

**Decision.** An app keeps one small route file per plugin page, which renders a component the
plugin exports:

```svelte
<!-- src/routes/settings/+page.svelte -->
<script>
	import SettingsPage from '@xcwds/plugin-settings/SettingsPage.svelte';
</script>

<SettingsPage />
```

`npm create @xcwds` writes these files for the plugins it installs, and `xcwds add <plugin>`
writes them later (#23). Plugins register each page in the route registry (title, emoji, back
target, width) so the shell and prerender `entries` know about it.

**Why not a catch-all route?** A single `[...path]` route that dispatches to plugin pages needs no
files, but loses SvelteKit's per-route code splitting and `+page.ts` loaders, and makes a stack
trace point at a dispatcher. It stays an option for later.

**Spike.** Test 2: [`src/routes/hello/+page.svelte`](../../examples/minimal/src/routes/hello/+page.svelte)
renders the plugin's `Page.svelte`; it is prerendered into `hello.html` and hydrates.

### 3. The service worker imports a generated file

SvelteKit 2 builds `src/service-worker.ts` in a separate Vite build with `configFile: false` and
only its own `$service-worker` plugin (`build_service_worker.js` in `@sveltejs/kit` 2.49), so a
Vite plugin's virtual modules don't resolve there.

**Decision.** The integration writes real files into `.xcwds/` (git-ignored) when
`svelte.config.js` loads, which happens before `svelte-kit sync`, `svelte-check`, `vite dev` and
`vite build`. `src/service-worker.ts` imports `.xcwds/worker.js`, which imports each plugin's
`./worker` entry and `onWorker` modules, and starts the worker runtime from
`@xcwds/sveltekit/worker` with the `$service-worker` lists. Normal package resolution works in
SvelteKit's worker build, so nothing else is needed. The runtime runs `onFetch` hooks first and
otherwise serves a baseline offline strategy (precache, then this version's cache first), so
every app installs and works offline. The strategy reads a cache policy (`app.worker.policy`:
extra precache paths, exclusions, the offline fallback page, runtime caching) once every worker
plugin has registered, so `@xcwds/plugin-offline` (#11) changes the policy instead of answering
fetches itself, and other plugins' `onFetch` hooks still run first.

SvelteKit 3 builds the worker as a Vite environment (`serviceWorker`), so virtual modules would
work there. The generated-file approach works on both, so it stays the single mechanism until
SvelteKit 2 support is dropped.

**Spike.** Test 3: the worker built from `.xcwds/worker.js` answers `/__xcwds/hello` from the
plugin's `onFetch` hook.

### 4. The pre-paint script is injected by a server hook and hashed for the CSP

`app.html` is a static template, and Vite's `transformIndexHtml` doesn't apply to SvelteKit pages.

**Decision.** Plugins return plain ES5 snippets from the `onHead` build hook, and settings fields
add theirs with `prePaint` (`app.settings.prePaintScript()`). A `handle` hook (exported by the
integration for `src/hooks.server.ts`) wraps each snippet in its own `try`, joins them into one
inline `<script>` after the manifest, icon and iOS tags, and replaces a `%xcwds.head%`
placeholder in `app.html` using `transformPageChunk`. Handle hooks run at prerender, including
for adapter-static's `404.html` fallback.

`onHead` snippets run before the settings' snippets, so a build entry can hand build-time data
to its field's `prePaint` (`@xcwds/plugin-theme` (#14) sets the brand's theme colours this way).
Page code can't `eval` a snippet under the hashed CSP, so a plugin that applies a setting again
at runtime ships the same logic as a function too, and tests that the two agree.

The placeholder goes **after** `%sveltekit.head%`, because SvelteKit puts its CSP `<meta>` first
in that output and a `<meta>` policy only covers what follows it. `withXcwds()` sets SvelteKit's
CSP in hash mode; SvelteKit hashes its own inline boot script, and `handle` adds the pre-paint
script's `sha256-` hash to `script-src` in that `<meta>` (or the CSP header, in `vite dev`).
The hash is added by `handle` rather than in `svelte.config.js` because settings fields come
from the plugins' `./client` entries, which only load in the page bundle, after the config.
Comments in `app.html` must not contain `%sveltekit.*%` text: SvelteKit replaces placeholders
anywhere in the file.

**Spike.** Test 4: `/`, `/hello` and an unknown URL (served `404.html`) all carry the CSP and
set `data-prepaint` with every JavaScript file blocked, so the attribute comes from the inline
script. Removing the hash from `script-src` makes the test fail, so the CSP really is enforced.

### 5. Encapsulation is a route prefix plus a storage namespace

Fastify scopes decorators and hooks by a context tree. Here a plugin's child context also has a
route `prefix` (route-bound hooks such as `onNavigate` only fire under it) and a storage
namespace (`app:<plugin>:<key>`). One namespace belongs to one plugin: a second plugin that derives
or asks for the same one fails to load, since sharing would mix their data and migration versions.

This is API hygiene, not isolation. Every script on the origin can read all of `localStorage`, so
**plugins are trusted code**. The docs say so, and #22 lists each plugin's declared network use.

### 6. The kernel is framework-agnostic

`@xcwds/core` is plain TypeScript with no Svelte or DOM-framework imports. State it exposes
(settings, saved values) offers `get`, `set` and `subscribe`; `@xcwds/sveltekit` wraps those in
Svelte 5 runes. A React or Vue integration could follow without kernel changes. SvelteKit is the
only integration planned for v1.

### 7. Navigations are the request lifecycle

The closest thing to a request is a navigation: `onNavigate(to, from)` can redirect or cancel
(like `onRequest`), and `afterNavigate(to)` runs once the page shows. In the worker, `onFetch`
hooks form a chain where the first returned `Response` wins (like `onRequest` plus
`reply.send()`), before the default caching strategy.

### 8. Close means "safe to reload"

A reload swaps code out from under the user. `onBeforeReload` hooks return a reason to wait (a
running timer), as does a name passed to `app.update.markBusy(name, isBusy)` for state a
component already holds; the update banner shows them (#12). The new worker never calls
`skipWaiting()` on install: it waits until the user taps Update. `app.close()` runs `onClose` hooks in reverse
registration order, in tests and on Vite HMR dispose, so dev reloads don't stack listeners.

### 9. Everything honours the base path

Apps on `user.github.io/repo` live under SvelteKit's `paths.base`. The manifest's `id`, `scope`
and `start_url`, the worker's scope and precache list, share URLs and route registry paths all
include it. The kernel stores paths without the base; the integration adds it at the edges.

### 10. "Never phone home" is checked at build time and enforced by the CSP

**Decision.** Plugins declare `network: false | { origins, reason }` (default `false`), read
from their build entry. `network` may instead be a function of the plugin's options, for origins
the app picks (#103); it is resolved with the options from the config, so origins stay fixed at
build time, which the prerendered CSP needs. After SvelteKit builds the site, `withXcwds()`'s adapter wrapper scans
SvelteKit's output (page bundle, service worker, static files, prerendered pages) for URLs on
other origins where they load or send something, and fails the build on any origin that no
plugin declares and `privacy.allowOrigins` doesn't list, naming the plugin whose package mentions
it. Scripts never load from other origins. The hash-mode CSP (decision 4) allows the declared
origins in `connect-src` (and `https:` ones for images, fonts, media and styles) and nothing else,
which is the real enforcement, since a static scan can't see URLs built at runtime. The page's
policy doesn't reach the service worker (a worker only gets one from its script's response
headers, and GitHub Pages sends none), so the generated worker imports a guard first, before any
plugin's worker entry, that limits `fetch`, `WebSocket`, `EventSource`, `WebTransport`,
`Cache#add`/`addAll` and background fetches to the same origins (#55). The settings page lists
the declarations. See [docs/privacy.md](../privacy.md).

The scan runs in the adapter because it is the first point where the worker (built in its own
Vite build, decision 3) and the prerendered pages both exist.

## Hook families

Defined in #5; listed here so the decisions above have names to point at.

- **Build:** `onConfig`, `onManifest`, `onHead`, `onWorker`, `onPrerender`
- **Runtime:** `onBoot`, `onReady`, `onNavigate`, `afterNavigate`, `onSettingsChange`,
  `onStorageChange`, `onBeforeReload`, `onHidden`, `onVisible`, `onError`, `onClose`
- **Worker:** `onInstall`, `onActivate`, `onFetch`, `onMessage`

## Not decided here

- Plugin option schemas: the kernel accepts any validator function returning the parsed value or
  `undefined`, like the storage entries. A schema library can be layered on later.
- Translations: out of scope for v1.
