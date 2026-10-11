# Privacy: never phone home

An @xcwds app keeps what people save on their device and talks to no server but the one it is
served from. The framework checks this rather than leaving it to habit ([#22](https://github.com/xcwds/xcwds/issues/22)):

1. **Plugins declare their network use.** Every plugin's metadata has `network`: `false` (the
   default) or the origins it contacts and why.
2. **The build fails on undeclared origins.** After SvelteKit builds the site, the adapter scans
   the page bundle, the service worker, static files and the prerendered pages for URLs on other
   origins, and stops the build on any that its plugins don't declare and `privacy.allowOrigins`
   doesn't list.
3. **The Content Security Policy enforces it.** Every page, including the `404.html` fallback,
   carries a `<meta>` CSP that only allows the app's own origin plus the declared ones.
4. **Settings shows it.** The settings page (`@xcwds/plugin-settings`) has a Privacy section
   listing the servers the app contacts and why, generated from the same metadata.

No `@xcwds` package sends telemetry, ever. A unit test scans every package's source, and the
example app's e2e tests check that no page makes a request off its origin.

## Declaring network use

Declare it on the plugin's build entry (the `build` export of its `.` entry), which the build
reads; the page and worker entries may repeat it:

```ts
// xcwds-plugin-weather/index.ts
export const build = definePlugin(() => {}, {
	name: 'xcwds-plugin-weather',
	network: {
		origins: ['https://api.weather.example'],
		reason: 'Fetches the forecast for the place you pick.'
	}
});
```

Origins are `https:` or `wss:` origins exactly as `new URL(x).origin` writes them (no path, no
trailing slash). `reason` is shown to people on the settings page, so write it for them. A plugin
with invalid `network` metadata fails to load with `XCWDS_ERR_PLUGIN_META`.

A declaration covers its own plugin only: if another plugin's sources use the same origin, that
plugin must declare it too, so the settings page names everyone who contacts it. A plugin
without a build entry can't declare anything; give it one (`export const build = definePlugin(...)`).

An app that contacts a server itself (not through a plugin) lists it in its config. Origins
listed there are allowed for the app and every plugin:

```ts
// xcwds.config.ts
export default defineConfig({
	brand: { name: 'Pocketbox' },
	privacy: { allowOrigins: ['https://api.example.com'] },
	plugins: []
});
```

## What the build scan looks for

URLs on another origin (absolute or protocol-relative) where they load or send something:

- JavaScript: `fetch`, `new Request`, `XMLHttpRequest`'s `open`, `WebSocket`, `EventSource`,
  `navigator.sendBeacon`, and code loading (`import`, `import()`, `importScripts`, workers).
- HTML, including markup Svelte compiles into JavaScript: `<script src>`, `<img src|srcset>`,
  `<iframe>`, `<video>`, `<audio>`, `<source>`, `<embed>`, `<object>`, and `<link href>` that
  loads something (`stylesheet`, `preload`, `modulepreload`, `icon`, `preconnect`, ...).
- CSS: `url(...)` and `@import`. Web fonts from a font CDN are the usual leak; bundle the font
  files with the app instead.

The error names the origin, the code and file it was found in, and the plugin whose package
mentions it:

```
@xcwds/sveltekit: the build contacts an origin that its plugins don't declare:

https://example.com, from plugin "xcwds-plugin-bad" (it declares no network use):
    fetch("https://example.com/track  (_app/immutable/chunks/WAzvenzg.js)
  If it's meant to, declare it in the metadata of the plugin's build entry (the `build` export of its package's "." entry): network: { origins: ['https://example.com'], reason: '...' }.
```

Scripts never load from another origin, declared or not: the CSP's `script-src` only allows the
app. Bundle the library instead.

A static scan can't see URLs built at runtime (`fetch(base + path)`), so it is a guard rail.
The CSP is what enforces the rule.

## The Content Security Policy

`withXcwds()` turns on SvelteKit's CSP in hash mode, so every prerendered page gets a
`<meta http-equiv="Content-Security-Policy">` with hashes for SvelteKit's boot script and the
pre-paint script. It allows:

| Directive                                                                            | Allows                                                                                    |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `default-src`, `script-src`, `manifest-src`, `worker-src`, `base-uri`, `form-action` | the app's origin only                                                                     |
| `connect-src`                                                                        | the app, plus declared origins                                                            |
| `img-src`, `font-src`, `media-src`, `style-src`                                      | the app (and `data:`/`blob:` where needed, inline styles), plus declared `https:` origins |
| `object-src`                                                                         | nothing                                                                                   |

Your own `kit.csp` directives are added to these. `adapter-static`'s `404.html` fallback is
rendered through the same hooks, so pages GitHub Pages serves for unknown URLs carry the policy
too.

### What a `<meta>` policy can't do

GitHub Pages can't set response headers, and a policy in a `<meta>` tag ignores some
directives:

- **`frame-ancestors`**: another site can put the app in a frame. Nothing in the app is
  sensitive to clickjacking (it has no account to act on), but a host that can set headers
  should send `Content-Security-Policy: frame-ancestors 'self'` (or `X-Frame-Options: DENY`).
- **Reporting** (`report-uri`, `report-to`): violations aren't reported anywhere, which suits an
  app that never phones home. They show in the browser console.
- **`sandbox`**: not available in `<meta>`.
- **The service worker**: a worker's policy comes only from the headers its script is served
  with, so the page's `<meta>` doesn't reach it. Instead, the generated `.xcwds/worker.js`
  first imports `.xcwds/worker-guard.js`, which runs before any plugin's `./worker` entry and
  limits the worker's `fetch`, `WebSocket`, `EventSource`, `WebTransport`, `Cache#add`/`addAll`
  and background fetches to the app's origin and the same declared origins as `connect-src`. Anything else fails with an
  error naming the origin. It's defence in depth, not a sandbox: plugins are trusted code.
  Dedicated or shared workers a plugin starts get no policy at all on such a host.

The policy also only covers what comes after the `<meta>` tag, which is why `%xcwds.head%`
goes after `%sveltekit.head%` in `app.html` (RFC 0001, decision 4).

## Keep user data out of URLs that reach a server

A query string goes to the server, and its logs, with every request; a fragment (`#...`) never
leaves the browser. Put anything a person typed or saved in the fragment:

- `@xcwds/plugin-share` moves shared links from the share target's `?query` to `#url=` in the
  service worker, before the page loads ([its README](../packages/plugin-share/README.md)).
- In development, `@xcwds/sveltekit` warns in the console when a page's query string carries a
  value the app has saved (`savedDataInQuery` from `@xcwds/core`).

## Plugins are trusted code

A plugin runs with full access to the page, its storage and the network the CSP allows. Storage
namespaces keep plugins from colliding, not from reading each other's data (RFC 0001,
decision 5). Review a third-party plugin before adding it, as you would any dependency, and
check what it declares under `network`.
