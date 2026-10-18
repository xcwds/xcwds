/**
 * `@xcwds/sveltekit/worker`: the service worker. `src/service-worker.ts` imports the generated
 * `.xcwds/worker.js` (RFC 0001, decision 3), which calls `startWorker()` with SvelteKit's
 * lists from `$app/manifest` and every plugin's `./worker` entry.
 *
 * Plugins' `onFetch` hooks answer first. Everything else gets one default strategy, so every
 * app installs and works offline: the build, static files and prerendered pages are precached
 * on install (bypassing the HTTP cache) and served from this version's cache first; other
 * requests go to the network, then (with runtime caching) the cache, then the fallback page for
 * navigations. Worker plugins tune it through `app.worker.policy` while they load
 * (`@xcwds/plugin-offline` turns on runtime caching and adds its options), so there is never a
 * second, competing strategy. A new version waits until every tab of the old one has closed, or
 * until a plugin calls `app.worker.skipWaiting()` (`@xcwds/plugin-update`).
 */
import { memoryStorage, type App, type LogLevel, type Plugin } from '@xcwds/core';
import type { WorkerData } from './data.js';
import { normalizePath, setupApp, stripBase, workerPath } from './routes.js';

export type WorkerOptions = WorkerData & {
	/** SvelteKit's `paths.base`, and the lists from `$app/manifest` with it. */
	base: string;
	build: string[];
	files: string[];
	prerendered: string[];
	version: string;
	/** Each plugin's `./worker` entry with its options from the config. */
	plugins: [Plugin<never>, Record<string, unknown>][];
	logLevel?: LogLevel;
};

/** How the default strategy caches. Paths are app paths, without the base path. */
export type CachePolicy = {
	/** Extra paths to precache, beside everything the build emits. */
	precache: string[];
	/**
	 * Globs of paths never precached or cached at runtime (`*` matches within a segment, `**`
	 * across segments). Requests for them still go to the network.
	 */
	exclude: string[];
	/** The page offline navigations get when nothing is cached for them. */
	fallback: string;
	/**
	 * Keeps same-origin `200` responses that aren't precached (and have no query string) in this
	 * version's cache, for when the network is gone.
	 */
	runtimeCaching: boolean;
};

/** What worker plugins get as `app.worker`. */
export type WorkerContext = {
	/** The build version. */
	readonly version: string;
	/** SvelteKit's `paths.base`. */
	readonly base: string;
	/** This version's cache. */
	readonly cacheName: string;
	/** The default strategy's settings: change them while your plugin loads. */
	readonly policy: CachePolicy;
	/** Lets this (waiting) version take over now instead of when the old one's tabs close. */
	skipWaiting(): Promise<void>;
};

declare module '@xcwds/core' {
	interface App {
		/** In the service worker (`@xcwds/sveltekit/worker`): its version, cache and policy. */
		readonly worker?: WorkerContext;
	}
}

// The few service-worker types used here (this package also type-checks against the DOM).
export type ExtendableEvent = Event & { waitUntil(promise: Promise<unknown>): void };
export type FetchEvent = ExtendableEvent & {
	request: Request;
	respondWith(response: Response | Promise<Response>): void;
};
export type MessageEvent = ExtendableEvent & { data: unknown };
/** The parts of `ServiceWorkerGlobalScope` the runtime uses (tests pass their own). */
export type WorkerScope = {
	location: { origin: string };
	registration: { scope: string };
	clients: { claim(): Promise<void> };
	skipWaiting(): Promise<void>;
	addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
	addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
	addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
};

/**
 * Every path to precache, once each: `cache.addAll()` rejects a list with duplicates, which
 * would stop the worker installing. `extra` paths and `exclude` globs are app paths.
 */
export function precacheList(
	options: Pick<WorkerOptions, 'base' | 'build' | 'files' | 'prerendered' | 'assets'>,
	{ extra = [], exclude = [] }: { extra?: string[]; exclude?: string[] } = {}
): string[] {
	const { base } = options;
	const excluded = (path: string) => {
		const appPath = stripBase(path, base);
		return appPath !== null && exclude.some((glob) => matchesGlob(glob, appPath));
	};
	return [
		...new Set([
			...options.build,
			...options.files,
			...options.prerendered,
			...options.assets.map((a) => `${base}/${a}`),
			...extra.map((p) => base + p)
		])
	].filter((path) => !excluded(path));
}

/** Whether an app path matches a glob: `*` within one segment, `**` across segments. */
export function matchesGlob(glob: string, path: string): boolean {
	const pattern = glob
		.split(/(\*\*\/?|\*)/)
		.map((part) => {
			if (part === '**/') return '(?:.*/)?';
			if (part === '**') return '.*';
			if (part === '*') return '[^/]*';
			return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
		})
		.join('');
	return new RegExp(`^${pattern}$`).test(path);
}

/** Starts the worker. Returns its app (for tests and plugins that need it). */
export function startWorker(
	options: WorkerOptions,
	scope: WorkerScope = globalThis as unknown as WorkerScope
): App {
	const sw = scope;
	const { base } = options;
	// One cache per app (scope) and version, so apps sharing an origin keep their own.
	const prefix = `xcwds:${sw.registration.scope}:`;
	const cacheName = `${prefix}${options.version}`;
	const policy: CachePolicy = {
		precache: [],
		exclude: [],
		fallback: '/404.html',
		runtimeCaching: false
	};
	const app = setupApp({ ...options, storage: memoryStorage() });
	app.decorate('worker', {
		version: options.version,
		base,
		cacheName,
		policy,
		skipWaiting: () => sw.skipWaiting()
	} satisfies WorkerContext);

	/** The strategy, settled once the plugins have loaded (and changed the policy). */
	const ready = app.ready().then(
		() => true,
		(error: unknown) => {
			// A plugin that fails to load is logged; the worker still serves the app without it.
			app.log.error(error);
			return false;
		}
	);
	const strategy = ready.then((ok) => {
		const exclude = [...policy.exclude];
		const assets = precacheList(options, { extra: policy.precache, exclude });
		return {
			ok,
			assets,
			precached: new Set(assets),
			fallback: base + normalizePath(policy.fallback),
			runtimeCaching: policy.runtimeCaching,
			excluded: (path: string) => exclude.some((glob) => matchesGlob(glob, path))
		};
	});
	// Requests are made with absolute URLs (the worker's own origin), so tests can run this too.
	const request = (path: string) =>
		new Request(new URL(path, sw.location.origin), { cache: 'reload' });

	sw.addEventListener('install', (event) => {
		event.waitUntil(
			(async () => {
				const { ok, assets, fallback } = await strategy;
				const cache = await caches.open(cacheName);
				// Bypass the HTTP cache, so a new version never precaches the previous one's files.
				await cache.addAll(assets.map(request));
				// `vite dev` and `vite preview` don't serve 404.html; only offline not-found pages need it.
				if (!assets.includes(fallback))
					await cache.add(request(fallback)).catch(() => {
						app.log.warn(`Couldn't cache ${fallback}; offline not-found pages won't work.`);
					});
				if (ok) await app.hooks.run('onInstall', [cache]);
			})()
		);
	});

	sw.addEventListener('activate', (event) => {
		event.waitUntil(
			(async () => {
				for (const key of await caches.keys())
					if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
				// Control pages opened before the worker existed, so they work offline right away.
				await sw.clients.claim();
				if (await ready) await app.hooks.run('onActivate', []);
			})()
		);
	});

	sw.addEventListener('message', (event) => {
		event.waitUntil(
			ready.then((ok) => (ok ? app.hooks.run('onMessage', [event.data]) : undefined))
		);
	});

	sw.addEventListener('fetch', (event) => {
		const { request } = event;
		const path = workerPath(request, sw.location.origin, base);
		if (path === null) return;
		const url = new URL(request.url);
		event.respondWith(
			(async () => {
				const s = await strategy;
				const answer = s.ok
					? await app.hooks.first('onFetch', [request, url], { path })
					: undefined;
				if (answer) return answer;
				const cache = await caches.open(cacheName);
				// This version's files come from its own cache, never the network, so the running
				// version stays consistent until the new one takes over.
				if (s.precached.has(url.pathname)) {
					const cached = await cache.match(url.pathname);
					if (cached) return cached;
				}
				const runtime = s.runtimeCaching && !s.excluded(path) && !s.precached.has(url.pathname);
				try {
					const response = await fetch(request);
					if (runtime && cacheable(url, response))
						event.waitUntil(
							cache.put(request, response.clone()).catch((error: unknown) => {
								app.log.warn(`Couldn't cache ${url.pathname}:`, error);
							})
						);
					return response;
				} catch (error) {
					const cached =
						(runtime && url.search === '' ? await cache.match(request) : undefined) ??
						(request.mode === 'navigate' ? await cache.match(s.fallback) : undefined);
					if (cached) return cached;
					throw error;
				}
			})()
		);
	});

	return app;
}

/** Only plain same-origin successes, and never a URL with a query (it may hold private data). */
function cacheable(url: URL, response: Response): boolean {
	return (
		url.search === '' &&
		response.status === 200 &&
		(response.type === 'basic' || response.type === 'default') &&
		!response.redirected
	);
}
