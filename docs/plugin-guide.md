# Writing a plugin

This guide builds a small plugin from an empty folder: a tally counter with its own page, a
setting, saved data that survives an upgrade, and tests. The finished plugin is
[`examples/plugin-tally`](../examples/plugin-tally) in the repository, and this docs site runs
it: open Tally from its Home page. Read [Concepts](concepts.md) first if plugins, hooks and decorators are
new to you.

## 1. The package

A plugin is an npm package. Name it `xcwds-plugin-<name>` (first-party plugins are
`@xcwds/plugin-<name>`) and give it the `xcwds-plugin` keyword, which is how people find
plugins on npm and how the [ecosystem](ecosystem.md) page lists them.

Its `exports` name the entries: `.` for the build, `./client` for the page and, when it needs
one, `./worker` for the service worker, plus any components. This one has no worker entry.

<!-- file: examples/plugin-tally/package.json -->
<!-- prettier-ignore -->
```json
{
	"name": "xcwds-plugin-tally",
	"version": "0.0.0",
	"private": true,
	"description": "A tally counter for @xcwds apps: the plugin the authoring guide builds, step by step.",
	"license": "MIT",
	"type": "module",
	"sideEffects": [
		"**/*.svelte"
	],
	"exports": {
		".": {
			"types": "./dist/index.d.ts",
			"default": "./dist/index.js"
		},
		"./client": {
			"types": "./dist/client.d.ts",
			"default": "./dist/client.js"
		},
		"./Tally.svelte": {
			"types": "./dist/Tally.svelte.d.ts",
			"svelte": "./dist/Tally.svelte",
			"default": "./dist/Tally.svelte"
		},
		"./package.json": "./package.json"
	},
	"files": [
		"dist",
		"!dist/**/*.test.*"
	],
	"keywords": [
		"xcwds-plugin",
		"counter"
	],
	"scripts": {
		"build": "svelte-package -i src -o dist",
		"check": "svelte-check --tsconfig ./tsconfig.json --fail-on-warnings",
		"publint": "publint"
	},
	"peerDependencies": {
		"@xcwds/core": "workspace:^",
		"@xcwds/sveltekit": "workspace:^",
		"svelte": "^5.0.0"
	},
	"devDependencies": {
		"@sveltejs/kit": "^2.49.1",
		"@sveltejs/package": "^2.5.8",
		"@sveltejs/vite-plugin-svelte": "^6.2.1",
		"@xcwds/core": "workspace:^",
		"@xcwds/sveltekit": "workspace:^",
		"@xcwds/testing": "workspace:*",
		"svelte": "^5.45.6",
		"svelte-check": "^4.3.4",
		"typescript": "^5.9.3",
		"vite": "^7.2.6",
		"vitest": "^4.0.15"
	}
}
```

`@xcwds/core`, `@xcwds/sveltekit` and `svelte` are peer dependencies (and dev dependencies, to
build and test with), because the app provides them: there must be one copy of each. A plugin
that brought its own `@xcwds/core` could end up with a second kernel once the app moves to a
newer minor, where its `declare module '@xcwds/core'` additions and error checks wouldn't reach
the app's. `svelte-package` compiles `src/` into `dist/`, keeping `.svelte` files as Svelte for
the app to compile.

## 2. Options

Options are written in the app's `xcwds.config.ts` and travel from Node into the page, so they
must be plain data. Check them in one function that both entries call, so a mistake fails the
build with your plugin's name rather than breaking a page:

<!-- file: examples/plugin-tally/src/options.ts -->

```ts
/** The plugin's options, checked the same way in the build and the page. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = 'xcwds-plugin-tally';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.2.0';

export type TallyOptions = {
	/** The tally page, an app path. Default `/tally`. */
	path?: string;
	/** How much one tap adds, until the user picks their own step in Settings. Default 1. */
	step?: number;
};

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

/** Checks options as written in the config and fills in the defaults. */
export function resolveOptions(options: TallyOptions = {}): Required<TallyOptions> {
	const { path = '/tally', step = 1, ...rest } = options;
	const unknown = Object.keys(rest);
	if (unknown.length) fail(`unknown option \`${unknown[0]}\`.`);
	if (typeof path !== 'string' || !/^\/[a-z0-9/-]*$/.test(path) || path.endsWith('/'))
		fail('`path` must be an app path such as "/tally".');
	if (!isStep(step)) fail('`step` must be a whole number from 1 to 100.');
	return { path, step };
}

export const isStep = (v: unknown): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100;
```

`XcwdsError` with `codes.CONFIG_INVALID` is how the framework reports a bad config. Refuse
unknown options: a typo would otherwise be silently ignored.

## 3. The build entry

The package's main entry is what the app imports in its config. Its default export is the
**factory**: `descriptor(name)` makes a function that returns `{ name, options }`, which is all
the config holds. Its `build` export is a plugin that runs in Node while the config loads:

<!-- file: examples/plugin-tally/src/index.ts -->

```ts
/**
 * The build entry: the factory you call in xcwds.config.ts, and the `build` plugin that runs in
 * Node while the config loads.
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type TallyOptions } from './options.js';

export type { TallyOptions } from './options.js';
export type { Tally } from './tally.js';

export default descriptor<TallyOptions>(NAME);

export const build = definePlugin(
	(app, options: TallyOptions) => {
		// A mistake in the options fails the build, not the page.
		const { path } = resolveOptions(options);
		app.route({ path, title: 'Tally', emoji: '🔢', parent: '/', width: 'narrow' });
	},
	{ name: NAME, core: CORE, network: false }
);
```

`app.route()` adds the page to the route registry: the shell shows its title and emoji in the
header and a back arrow to `parent`, and the build prerenders it. `width` names the container
the page uses (`narrow` for tools, `wide` for lists, `split` for a page that is narrow until
wide screens and then lays out two columns). `network: false` says the plugin contacts
no server; it is the default, but saying it makes the promise visible.

## 4. What the plugin saves

Keep the logic in plain functions with no framework in them: they are the easiest part to test.
Saved data can be anything (an old version's, a hand-edited backup's), so `parseTally` checks
every field and returns `undefined` for anything that isn't a tally:

<!-- file: examples/plugin-tally/src/tally.ts -->

```ts
/** What the plugin saves: the count, and when counting started. */
export type Tally = { count: number; since: string };

/** Returns `raw` if it is a valid tally, otherwise `undefined` (saved data can be anything). */
export function parseTally(raw: unknown): Tally | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const { count, since } = raw as Record<string, unknown>;
	if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return undefined;
	if (typeof since !== 'string' || Number.isNaN(Date.parse(since))) return undefined;
	return { count, since };
}

/** `tally` plus `step`, starting a new tally (from `now`) when there is none. */
export function add(tally: Tally | undefined, step: number, now = new Date()): Tally {
	return { count: (tally?.count ?? 0) + step, since: tally?.since ?? now.toISOString() };
}
```

## 5. The page entry

`./client` runs in the page. It is also imported in Node while SvelteKit prerenders, so it must
not touch `window`, `document` or `localStorage` at the top level; do that in `onBoot` and later
hooks, which only run in the browser.

<!-- file: examples/plugin-tally/src/client.ts -->

```ts
/**
 * The page entry. It runs in the browser, and in Node while SvelteKit prerenders, so it doesn't
 * touch `window` or `document` here (only in hooks such as `onBoot`).
 */
import { definePlugin, type Entry } from '@xcwds/core';
import { CORE, NAME, isStep, resolveOptions, type TallyOptions } from './options.js';
import { parseTally, type Tally } from './tally.js';

/** `app.tally`. */
export type AppTally = {
	/** The saved tally, for `persist()` or `app.storage.read()`. */
	readonly entry: Entry<Tally>;
};

declare module '@xcwds/core' {
	interface App {
		/** From xcwds-plugin-tally. */
		readonly tally?: AppTally;
	}
	interface Settings {
		/** From xcwds-plugin-tally: how much one tap adds. */
		tallyStep: number;
	}
}

export default definePlugin(
	(app, options: TallyOptions) => {
		const { step } = resolveOptions(options);

		app.settings.field('tallyStep', {
			default: step,
			parse: (v) => (isStep(v) ? v : undefined),
			label: 'Tally step',
			hint: 'How much one tap adds.',
			section: 'tally',
			control: { type: 'number', min: 1, max: 100 }
		});

		// Saved as `app:tally:tally`.
		const entry = app.storage.entry('tally', { label: 'Tally', parse: parseTally });

		// Version 0 of this plugin saved a bare number. Version 1 saves `{ count, since }`.
		app.storage.migration({
			to: 1,
			run(data) {
				const old = data[entry.key];
				if (typeof old === 'number')
					data[entry.key] = { count: old, since: new Date().toISOString() };
			}
		});

		app.decorate('tally', { entry } satisfies AppTally);
	},
	// Without `encapsulate: false`, `app.tally` would stay inside this plugin.
	{ name: NAME, core: CORE, encapsulate: false }
);
```

What each part does:

- **`app.settings.field()`** adds `tallyStep` to the app's settings. The option sets its
  default; once the user picks a step on the settings page, theirs wins. `control` tells the
  settings page to show a − / + stepper, in a `tally` section.
- **`app.storage.entry()`** registers the saved tally under the plugin's namespace, derived
  from its name: `xcwds-plugin-tally` saves under `app:tally:`. Registered entries appear in
  backups and can be cleared from the settings page, with the label people read there.
- **`app.storage.migration()`** upgrades data saved by an older version. Say version 0 of the
  plugin saved a bare number: migration 1 turns it into `{ count, since }`, on the device the
  first time the new version runs, and in any backup made before it. Each namespace keeps its
  own version, so add migrations with higher `to` numbers as the data changes again.
- **`app.decorate()`** gives the app `app.tally`, and `declare module` types it for every app
  that installs the plugin. It's optional (`tally?`) because an app may not have it.
  `encapsulate: false` makes it visible to the whole app; without it, only this plugin would
  see it.

## 6. The page

The plugin's page is a Svelte component. It reads the app with `useApp()`, ties the tally to the
saved entry with `persist()` (which loads after mount, saves each change and follows other
tabs), and reads the setting from `settings.current`:

<!-- file: examples/plugin-tally/src/Tally.svelte -->

```svelte
<script lang="ts">
	/** The tally page. An app shows it from a route file of its own. */
	import { persist, settings, useApp } from '@xcwds/sveltekit';
	import { add, type Tally as SavedTally } from './tally.js';
	import type {} from './client.js';

	// `app.tally` is optional: say what's missing rather than fail on `undefined`.
	const plugin = useApp().tally;
	if (!plugin)
		throw new Error('xcwds-plugin-tally: add tally() to the plugins in xcwds.config.ts.');
	let tally = $state<SavedTally | undefined>();
	// Loads the saved tally after mount, saves every change, and follows other tabs.
	persist(
		plugin.entry,
		() => tally,
		(v) => (tally = v),
		{ cleared: () => (tally = undefined) }
	);
	const step = $derived(settings.current.tallyStep);
</script>

<div class="tally">
	<p class="count" data-testid="tally">{tally?.count ?? 0}</p>
	<p class="since">
		{tally ? `Counting since ${new Date(tally.since).toLocaleDateString()}.` : 'Tap to count.'}
	</p>
	<div class="buttons">
		<button type="button" onclick={() => (tally = add(tally, step))}>+{step}</button>
		<button type="button" onclick={() => (tally = undefined)} disabled={!tally}>Reset</button>
	</div>
</div>

<style>
	/* Plain CSS with the shell's variables, so the app needs no Tailwind setup for it. */
	.tally {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding-top: 0.5rem;
	}
	.count {
		font-size: 3rem;
		font-variant-numeric: tabular-nums;
	}
	.since {
		opacity: 0.7;
	}
	.buttons {
		display: flex;
		gap: 0.5rem;
	}
	button {
		min-width: 5rem;
		border-radius: 0.75rem;
		padding: 0.5rem 1rem;
		background: var(--xcwds-shell-card);
	}
	button:disabled {
		opacity: 0.5;
	}
</style>
```

It checks for `app.tally` before using it, so an app that has the route file but not `tally()`
in its config gets an error that says so.

The styles are plain CSS that uses the shell's variables, so the component works without the
app scanning your package for Tailwind classes. If you'd rather use Tailwind, ship a CSS file
with an `@source` line for your `dist` folder, as the first-party plugins' `styles.css` do.

## 7. Tests

`@xcwds/testing` boots a real app in Node with your plugin, like Fastify's `inject()`: the
plugin loads, its hooks run, and storage is in memory, with whatever a test puts there.

<!-- file: examples/plugin-tally/src/tally.test.ts -->

```ts
import { memoryStorage } from '@xcwds/core';
import { buildTestApp, type Importer } from '@xcwds/testing';
import { describe, expect, it } from 'vitest';
import tally from './index.js';
import { resolveOptions } from './options.js';
import { add, parseTally } from './tally.js';

// Test apps load a descriptor's entries by package name. A package can't always import itself
// by name, so point the names at the source files.
const importer: Importer = async (id) => {
	if (id === 'xcwds-plugin-tally') return import('./index.js');
	if (id === 'xcwds-plugin-tally/client') return import('./client.js');
	throw Object.assign(new Error(id), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
};

const NOW = new Date('2026-10-01T09:00:00Z');

describe('options', () => {
	it('fills in defaults and refuses mistakes', async () => {
		expect(resolveOptions()).toEqual({ path: '/tally', step: 1 });
		expect(() => resolveOptions({ step: 0 })).toThrow(/`step`/);
		expect(() => resolveOptions({ path: 'tally' })).toThrow(/`path`/);
		expect(() => resolveOptions({ colour: 'red' } as never)).toThrow(/unknown option `colour`/);
		// In an app, the same mistake fails while the config loads.
		await expect(
			buildTestApp({ plugins: [tally({ step: 1.5 })] }, { import: importer })
		).rejects.toThrow(/xcwds-plugin-tally: `step`/);
	});
});

describe('tally', () => {
	it('counts up from a new tally', () => {
		const first = add(undefined, 1, NOW);
		expect(first).toEqual({ count: 1, since: NOW.toISOString() });
		expect(add(first, 5)).toEqual({ count: 6, since: NOW.toISOString() });
	});

	it('ignores saved data that isn’t a tally', () => {
		expect(parseTally({ count: 3, since: NOW.toISOString() })).toEqual({
			count: 3,
			since: NOW.toISOString()
		});
		expect(parseTally({ count: -1, since: NOW.toISOString() })).toBeUndefined();
		expect(parseTally({ count: 3, since: 'yesterday' })).toBeUndefined();
		expect(parseTally(3)).toBeUndefined();
	});
});

describe('in an app', () => {
	it('adds its page, its setting and app.tally', async () => {
		const app = await buildTestApp({ plugins: [tally({ step: 5 })] }, { import: importer });
		expect(app.routes.get('/tally')).toMatchObject({ title: 'Tally', emoji: '🔢' });
		expect(app.settings.get().tallyStep).toBe(5);
		expect(app.tally!.entry.key).toBe('app:tally:tally');
		expect(app.storage.write(app.tally!.entry, add(undefined, 5, NOW))).toBe(true);
		expect(app.storage.read(app.tally!.entry)?.count).toBe(5);
	});

	it('upgrades a count saved by version 0', async () => {
		const app = await buildTestApp(
			{ plugins: [tally()] },
			{ import: importer, now: NOW, storage: memoryStorage({ 'app:tally:tally': '7' }) }
		);
		expect(app.storage.read(app.tally!.entry)).toEqual({ count: 7, since: NOW.toISOString() });
	});

	it('keeps a step the user picked, and ignores one out of range', async () => {
		const storage = memoryStorage({ 'app:settings': JSON.stringify({ tallyStep: 10 }) });
		const app = await buildTestApp({ plugins: [tally()] }, { import: importer, storage });
		expect(app.settings.get().tallyStep).toBe(10);
		storage.data.set('app:settings', JSON.stringify({ tallyStep: 1000 }));
		const other = await buildTestApp({ plugins: [tally()] }, { import: importer, storage });
		expect(other.settings.get().tallyStep).toBe(1);
	});
});
```

- **`buildTestApp(input, options)`** takes a config's `plugins` (or a whole config) and resolves
  each descriptor through `import`, so the test exercises the same path an app does. Pointing
  the names at the source files lets the tests run without a build.
- **`storage: memoryStorage({...})`** starts with saved data, here a count from version 0, so
  the migration runs as it would on a user's phone.
- **`now`** fixes the clock (`Date`, `performance` and timers), so dates in saved data are
  predictable. `app.clock.advance(ms)` and `jump(ms)` move it, for timers.

Run them with Vitest (`environment: 'node'` is enough). For your page in a real browser, use
`gotoHydrated` and `auditTapTargets` from `@xcwds/testing/playwright` in the app's end-to-end
tests; see the [testing reference](../packages/testing).

## 8. Use it in an app

Install the package, add it to the config and give the page a route file:

```ts
// xcwds.config.ts
import tally from 'xcwds-plugin-tally';

export default defineConfig({
	brand,
	plugins: [
		shell({ sections: [/* … */ { path: '/tally', label: 'Tally', emoji: '🔢' }] }),
		tally({ step: 1 }),
		settings()
	]
});
```

```svelte
<!-- src/routes/tally/+page.svelte -->
<script lang="ts">
	import Tally from 'xcwds-plugin-tally/Tally.svelte';
</script>

<main class="page-narrow"><Tally /></main>
```

If `settings()` is installed, its page shows a Tally section with the step, and backups include
the tally.

## 9. Publish it

- Build with `svelte-package` and check the package with [publint](https://publint.dev).
- Keep `xcwds-plugin` in `keywords`, and say in the README what the plugin saves and whether it
  contacts any server.
- Set `core` in every entry's `definePlugin` metadata to the range of `@xcwds/core` you tested
  with, the same as your peer dependency (`CORE` in `options.ts` above), so an app on an
  incompatible version gets a clear `XCWDS_ERR_PLUGIN_VERSION_MISMATCH` instead of a broken
  page. On 0.x a `^` range only allows patches, so release a new version for each core minor.

## More to reach for

- **Service worker.** A `./worker` entry with `onFetch` hooks answers requests:
  [`examples/plugin-hello`](../examples/plugin-hello) answers one URL. Return nothing to leave a
  request to the default offline strategy.
- **Before first paint.** An `onHead` build hook, or `prePaint` on a settings field, returns a
  plain ES5 snippet that runs before the page shows; the theme uses it so dark mode never
  flashes white.
- **Busy work.** If your page holds something a reload would lose, return a reason from
  `onBeforeReload`, and the update banner waits for it.
- **A tool.** To list your page with the app's tools, call `app.tools?.add(tool)` from both
  entries; see [plugin-tools](../packages/plugin-tools).
- **The network.** If your plugin must contact a server, declare it in `network` with a reason
  people can read. See [Privacy](privacy.md).
