# @xcwds/core

The kernel of [@xcwds](https://github.com/xcwds/xcwds): a Fastify-style plugin system for private,
offline-first PWAs. It has no UI and no framework dependency; `@xcwds/sveltekit` binds it to
SvelteKit. Design: [RFC 0001](../../docs/rfc/0001-architecture.md).

```ts
import { createApp, definePlugin } from '@xcwds/core';

declare module '@xcwds/core' {
	interface App {
		greet(name: string): string;
	}
	interface Settings {
		greeting: string;
	}
}

const greeter = definePlugin(
	(app) => {
		app.settings.field('greeting', {
			default: 'Hello',
			parse: (v) => (typeof v === 'string' ? v : undefined)
		});
		app.decorate('greet', (name: string) => `${app.settings.get().greeting}, ${name}`);
		app.addHook('onReady', () => app.log.info('greeter ready'));
	},
	{ name: 'greeter', encapsulate: false }
);

const app = createApp();
app.register(greeter);
await app.ready();
app.greet('you'); // "Hello, you"
```

## Plugins

- `app.register(plugin, { prefix, ...options })` queues a plugin; `await app.load()` loads them
  depth-first in order (avvio semantics) and `await app.ready()` then runs `onReady` hooks.
- `definePlugin(fn, meta)` attaches `name`, `core` (semver range of this package),
  `dependencies`, `decorators`, `encapsulate`, `network` and `namespace`. They are checked at
  load and fail with an `XcwdsError` whose `code` and `plugin` say what and who. `network` is
  `false` (the default) or `{ origins, reason }`: the servers the plugin contacts and why
  ([docs/privacy.md](../../docs/privacy.md)).
- Each plugin has its own view of the app. Decorators it adds stay in its scope unless it sets
  `encapsulate: false` (like `fastify-plugin`). Its `prefix` joins its parents' prefixes.
- A plugin that doesn't finish loading in 10 s (`pluginTimeout`) fails with its name.
- `app.close()` runs `onClose` hooks in reverse order.

## Hooks

`app.addHook(name, fn)` for the build, runtime and worker families listed in `hooks.ts`.
`app.hooks.run`, `.first` (first answer wins, like `onFetch`), `.collect`, `.reduce` (each
hook may replace a value, like `onManifest`) and `.firstNow` (`first`, but synchronous while
the hooks are, for navigation guards) run them; route hooks
(`onNavigate`, `afterNavigate`, `onFetch`) only run for paths under the adding plugin's prefix.
A hook that throws is reported to `onError` hooks (or `app.log`) and the rest still run.
Errors are only ever logged locally.

## Storage

`app.storage.entry(name, { label, parse })` registers a saved value under the plugin's
namespace (`app:<namespace>:<name>`, or an exact `key` to keep an existing one). Reads never
throw; writes return whether they saved. Each namespace has its own schema version and
`migration({ to, run })`s, which also upgrade older backups. When storage is too full to save a
migration, the migrated data stays in memory (reads and backups see it) and is saved, with the
version, by the next write to that namespace that fits. `exportData`, `parseBackup` and
`importData` make backups; a `replace` import that doesn't fit puts the previous data back.
`unclaimed()` lists data left by plugins that were removed. Backups keep that data with its schema
version, so a backup still imports after a plugin is removed, and the plugin's migrations pick
up where they left off if it comes back.
`startSync()` follows other tabs. `localStorage` holds about 5 MB per origin; pass another
`StorageAdapter` to `createApp({ storage })` to change where data lives.

Namespaces are API hygiene, not a sandbox: every plugin can read all of the origin's storage.
Only add plugins you trust.

## Settings

`app.settings.field(name, { default, parse, section, prePaint })` adds a field to the app-wide
settings (saved as `app:settings`). Invalid or missing fields read as their default; fields of
plugins that aren't registered are kept. `set`, `update`, `reset`, `save` (explicit, returns the
result) and `subscribe`; `prePaintScript()` builds the inline script that applies `prePaint`
fields before first paint.

## Config

`defineConfig`, `validateConfig` / `resolveConfig` (errors carry key paths), `descriptor(name)`
for plugin factories, `createManifest(config, { base })` and `headTags(config, { base })`.
`@xcwds/core/build` (Node only) has `renderIcons()`, which needs the optional peer dependency
`@resvg/resvg-js`.
