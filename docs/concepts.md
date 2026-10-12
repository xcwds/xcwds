# Concepts

@xcwds copies [Fastify](https://fastify.dev)'s shape: a small core, and every feature a plugin
with hooks, decorators and declared dependencies. If you know Fastify, the
[architecture RFC](rfc/0001-architecture.md) maps one onto the other. This page explains each
idea on its own.

## Plugins

A plugin is a function that gets the app and its options, and adds to it:

```ts
import { definePlugin } from '@xcwds/core';

export default definePlugin(
	(app, options: { greeting?: string }) => {
		app.addHook('onReady', () => app.log.info(options.greeting ?? 'hello'));
	},
	{ name: 'xcwds-plugin-hello' }
);
```

`definePlugin` attaches metadata, checked when the plugin loads:

| Field          | Meaning                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------- |
| `name`         | Unique, usually the package name. Errors name the plugin by it.                           |
| `core`         | The semver range of `@xcwds/core` the plugin supports.                                    |
| `dependencies` | Plugins that must be registered before this one.                                          |
| `decorators`   | Decorators that must already exist where this one is registered.                          |
| `encapsulate`  | `false` makes its decorators visible to the whole app (see below).                        |
| `network`      | `false` (the default) or the servers it contacts and why (see [Privacy](#privacy)).       |
| `namespace`    | Where its saved data lives (`app:<namespace>:<key>`); defaults to a short form of `name`. |

Plugins load in order, depth first: a plugin that registers others finishes them before the next
one starts, and one that takes more than 10 seconds fails with its name.

### Three places to run

A web app runs code in three places, so a plugin package has up to three entries:

| Entry      | Runs in                                    | Typically holds                                     |
| ---------- | ------------------------------------------ | --------------------------------------------------- |
| `.`        | Node, while the build loads the config     | The factory you call in the config, and build hooks |
| `./client` | The page (and Node, while pages prerender) | Decorators, settings, saved data and runtime hooks  |
| `./worker` | The service worker                         | Answers to requests, for offline and sharing        |

Calling a plugin in `xcwds.config.ts`, as in `timers({ page: '/timers' })`, doesn't run it: it
returns `{ name, options }`. The build loads the package's `.` entry, then generates imports of
`./client` for the page and `./worker` for the service worker, and registers each with the same
options. That is why options must be plain data: they travel from Node into the page and the
worker. Build-only code never reaches the page, and page code never reaches the worker.

### Pages

SvelteKit only has routes in `src/routes/`, and a package can't add files there. So a plugin's
page is a component it exports, and the app keeps a small route file that renders it:

```svelte
<!-- src/routes/settings/+page.svelte -->
<script>
	import SettingsPage from '@xcwds/plugin-settings/SettingsPage.svelte';
</script>

<main class="page-narrow"><SettingsPage /></main>
```

`npm create @xcwds` and `xcwds add` write these files for you. The plugin adds the page to the
**route registry** with `app.route({ path, title, emoji, parent })` from its build entry, so the
header shows its title and back arrow and the build prerenders it.

## Encapsulation

Each plugin sees its own view of the app. What it adds with `app.decorate()` stays inside it
and the plugins it registers, unless it sets `encapsulate: false`. A plugin meant to give the
whole app something, as most do, sets it.

Each plugin also gets a **prefix** (`app.register(plugin, { prefix: '/tools' })`): route hooks
such as `onNavigate` only run for paths under it. And it gets a **storage namespace**: its saved
keys start with `app:<namespace>:`, and no two plugins can share one.

This is tidiness, not a security boundary. Every script on the site can read all of its
storage, so **plugins are trusted code**: only add ones you would trust with your users' data.

## Hooks

Hooks are how plugins take part in what happens. `app.addHook(name, fn)` adds one; they run in
the order they were added, and one that throws is reported to `onError` without stopping the
others. There are three families, one per place code runs.

**Build hooks** run in Node:

| Hook          | When                               | Returns                                   |
| ------------- | ---------------------------------- | ----------------------------------------- |
| `onConfig`    | The config has loaded              | A changed config, or nothing              |
| `onManifest`  | The web app manifest is generated  | A changed manifest, or nothing            |
| `onHead`      | The pre-paint script is built      | Plain ES5 that runs before the page shows |
| `onWorker`    | The service worker is generated    | Module specifiers to import into it       |
| `onPrerender` | The build lists pages to prerender | Extra paths                               |

**Runtime hooks** run in the page:

| Hook               | When                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| `onBoot`           | The page has mounted (the first moment `window` and `document` are safe) |
| `onReady`          | Every plugin has booted                                                  |
| `onNavigate`       | Before a navigation: return a path to redirect, or `false` to cancel     |
| `afterNavigate`    | The new page shows                                                       |
| `onSettingsChange` | A setting changed, here or in another tab                                |
| `onStorageChange`  | Saved data changed in another tab, or was cleared or imported            |
| `onBeforeReload`   | Before an update reloads the page: return a reason to wait               |
| `onHidden`         | The page went into the background                                        |
| `onVisible`        | The page came back                                                       |
| `onError`          | A hook or plugin failed (errors are only ever logged on the device)      |
| `onClose`          | The app closes (tests, and dev reloads), in reverse order                |

**Worker hooks** run in the service worker:

| Hook         | When                                                         |
| ------------ | ------------------------------------------------------------ |
| `onInstall`  | A new version installs, after the precache                   |
| `onActivate` | It takes over                                                |
| `onFetch`    | A request: return a `Response` to answer it (the first wins) |
| `onMessage`  | A page posted a message                                      |

A plugin can define hooks of its own by merging into the `Hooks` interface.

## Decorators

`app.decorate(name, value)` adds a property to the app: `app.toast`, `app.timers`,
`app.update`. Components reach it with `useApp()` from `@xcwds/sveltekit`. Declare its type by
merging into the `App` interface, so every app that installs the plugin gets it typed:

```ts
declare module '@xcwds/core' {
	interface App {
		readonly timers?: AppTimers;
	}
}
```

Mark it optional (`?`) when the plugin might not be installed, so code that uses it checks.

## Saved data and settings

Nothing an app saves leaves the device. Every saved value is a registered **entry** with a key,
a label people can read and a `parse` function that returns the value if it is valid and
`undefined` if not:

```ts
const presets = app.storage.entry('presets', { label: 'Timer presets', parse: parsePresets });
app.storage.write(presets, [{ label: 'Tea', ms: 180_000 }]); // true if it saved
app.storage.read(presets); // the value, or undefined: reads never throw
```

Because every value is registered, the settings page can export them all as a backup, import
one, and clear them by group, and reading data that a bug or an old version left behind never
breaks a page. Each namespace has a schema version: when a plugin changes what it saves, it adds
a **migration**, which upgrades both the data on the device and older backups.

An entry registered with `backup: false` stays out of backups: exports leave it out, and imports
neither write it nor clear it, so restoring a backup doesn't sign anyone out of a service. Use it
for secrets such as access tokens and for caches that can be downloaded again. Clearing its group,
or all data, still removes it, and the settings page marks it "Not in backups". Once its plugin is
removed, nothing marks the data any more, so it would go into backups as unclaimed data: clear a
plugin's data before removing it.

**Settings** are one app-wide object (saved as `app:settings`), to which each plugin adds fields
with a default, a `parse` function and optionally a control that the settings page shows:

```ts
app.settings.field('alarm', {
	default: true,
	parse,
	label: 'Alarm sound',
	control: { type: 'switch' }
});
```

A missing or invalid field reads as its default, so a new field needs no migration. A field can
also apply itself before the page first paints (`prePaint`), as the theme does, so a dark-mode
user never sees a white flash.

In components, `persist()` from `@xcwds/sveltekit` ties an entry to a piece of state: it loads
after mount, saves when the value changes and follows other tabs. `settings.current` is the
settings object, reactively.

## Updates

A reload in the middle of something loses it: a running timer, a half-typed note. So a new
version never takes over by itself. The service worker installs it in the background and the
page offers **Update**; until the user taps it, even a relaunch keeps the old version. Code that
holds work in progress says so, with an `onBeforeReload` hook or
`app.update.markBusy(name, isBusy)`, and the banner asks before reloading. When one tab updates,
hidden tabs with nothing busy reload quietly and the others offer Reload.

## Privacy

"Never phone home" is checked, not promised. A plugin that contacts a server declares it:

```ts
definePlugin(fn, {
	name: 'xcwds-plugin-sync',
	network: { origins: ['https://sync.example.com'], reason: 'Syncs your notes between devices.' }
});
```

When the site is built, the build scans everything it produced for calls to other servers and
fails on any origin no plugin declares. The page's Content Security Policy only allows the
declared origins, which is what stops calls the scan can't see. The settings page lists each
server and why. [Privacy](privacy.md) has the details.
