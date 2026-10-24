/**
 * The service-worker entry. The integration's runtime already precaches the build and serves
 * it from this version's cache first (`@xcwds/sveltekit/worker`); this plugin tunes that one
 * strategy through `app.worker.policy` instead of adding a second one: runtime caching, extra
 * precached paths, exclusions and the offline fallback page. Other plugins' `onFetch` and
 * `onInstall` hooks still run before it.
 *
 * With `byApp`, the pages of `@xcwds/plugin-tools`' apps are deferred (`policy.defer`): install
 * caches those of the apps that are on, which the page sends (`APPS_MESSAGE`) and this entry
 * saves in a cache of its own, since a worker can't read the page's storage.
 */
import { definePlugin, XcwdsError, codes, type App } from '@xcwds/core';
import { stripBase } from '@xcwds/sveltekit/routes';
import type { WorkerContext } from '@xcwds/sveltekit/worker';
import { CORE, NAME, isAppsMessage, resolveOptions, type OfflineOptions } from './options.js';

/** The part of `@xcwds/plugin-tools`' `app.tools` this entry reads. */
type Apps = {
	apps(): readonly { id: string; default?: boolean }[];
	appOf(path: string): { id: string } | undefined;
};

/** Where the apps that are on are saved: outside the versioned caches, so updates keep it. */
export const appsCacheName = (scope: string) => `xcwds-offline:${scope}`;
const appsKey = (scope: string) => new URL('.xcwds-offline/apps.json', scope).href;

export default definePlugin(
	(app, input: OfflineOptions) => {
		const options = resolveOptions(input);
		const worker = app.worker;
		if (!worker)
			throw new XcwdsError(
				codes.PLUGIN_FAILED,
				`${NAME}/worker runs in the service worker that @xcwds/sveltekit/worker starts.`,
				{ plugin: NAME }
			);
		const { policy } = worker;
		policy.precache.push(...options.precache);
		policy.exclude.push(...options.exclude);
		policy.fallback = options.fallback;
		policy.runtimeCaching = options.runtimeCaching;
		if (options.byApp) byApp(app, worker);
	},
	{ name: NAME, core: CORE, network: false }
);

function byApp(app: App, worker: WorkerContext) {
	// Read when the strategy settles, after every plugin has loaded, so the order in the config
	// doesn't matter.
	const tools = () => (app as { tools?: Apps }).tools;
	worker.policy.defer = (path) => tools()?.appOf(path) !== undefined;
	app.addHook('onReady', () => {
		if (!tools()?.apps().length)
			app.log.warn(
				`${NAME}: \`byApp\` needs @xcwds/plugin-tools with \`apps\`; every page is precached.`
			);
	});

	const { scope } = worker;
	const request = (path: string) => new Request(new URL(path, scope), { cache: 'reload' });
	const appOf = (path: string) => {
		const appPath = stripBase(path, worker.base);
		return appPath === null ? undefined : tools()?.appOf(appPath)?.id;
	};
	const defaults = () =>
		(tools()?.apps() ?? []).filter((a) => a.default !== false).map((a) => a.id);
	const all = () => (tools()?.apps() ?? []).map((a) => a.id);

	/** The apps saved as on, or undefined before any page said. */
	async function saved(): Promise<string[] | undefined> {
		const cache = await caches.open(appsCacheName(scope));
		const data: unknown = await (await cache.match(appsKey(scope)))?.json().catch(() => undefined);
		return Array.isArray(data) && data.every((id) => typeof id === 'string') ? data : undefined;
	}
	async function save(on: string[]) {
		const cache = await caches.open(appsCacheName(scope));
		await cache.put(
			appsKey(scope),
			new Response(JSON.stringify(on), { headers: { 'content-type': 'application/json' } })
		);
	}

	/** Caches the deferred pages of the apps in `on` that this version's cache lacks. */
	async function download(cache: Cache, on: readonly string[]) {
		const missing: string[] = [];
		for (const path of await worker.deferred()) {
			const id = appOf(path);
			if (id !== undefined && on.includes(id) && !(await cache.match(path))) missing.push(path);
		}
		// All or nothing, like the install precache: a failure leaves them for the next message.
		if (missing.length) await cache.addAll(missing.map(request));
	}

	/** Whether an older version of this app is installed (its cache is still there). */
	async function updating(): Promise<boolean> {
		const prefix = worker.cacheName.slice(0, -worker.version.length);
		return (await caches.keys()).some((key) => key.startsWith(prefix) && key !== worker.cacheName);
	}

	// An update precaches the apps that were on, so none of them stops working offline; an update
	// from a version without `byApp` (nothing saved yet), every app, as that version kept them; a
	// first install, the apps that start on.
	app.addHook('onInstall', async (cache) => {
		await download(cache as Cache, (await saved()) ?? ((await updating()) ? all() : defaults()));
	});

	// Apps turned on or off while this version waited reached the old one only: catch up now.
	app.addHook('onActivate', async () => {
		const on = await saved();
		if (!on) return;
		try {
			const cache = await caches.open(worker.cacheName);
			for (const path of await worker.deferred()) {
				const id = appOf(path);
				if (id !== undefined && !on.includes(id)) await cache.delete(path);
			}
			await download(cache, on);
		} catch (error) {
			// Offline, say: the next message from a page downloads what's missing.
			app.log.warn(`${NAME}: couldn't download the apps that are on:`, error);
		}
	});

	app.addHook('onMessage', async (data: unknown) => {
		if (!isAppsMessage(data)) return;
		const known = new Set((tools()?.apps() ?? []).map((a) => a.id));
		const on = [...new Set(data.on)].filter((id) => known.has(id));
		// With nothing saved yet, any app may be cached (an update from a version without `byApp`
		// keeps them all).
		const before = (await saved()) ?? all();
		await save(on);
		const cache = await caches.open(worker.cacheName);
		// Only apps that were on and now aren't: a page of an app that's off, cached when visited,
		// stays until the app is turned on and off again.
		const dropped = before.filter((id) => !on.includes(id));
		if (dropped.length)
			for (const path of await worker.deferred()) {
				const id = appOf(path);
				if (id !== undefined && dropped.includes(id)) await cache.delete(path);
			}
		await download(cache, on);
	});
}
