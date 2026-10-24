import { definePlugin } from '@xcwds/core';
import { buildTestApp, buildTestWorker, type Importer } from '@xcwds/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import client from './client.js';
import offline from './index.js';
import { APPS_MESSAGE, resolveOptions } from './options.js';
import worker, { appsCacheName } from './worker.js';

afterEach(() => void vi.unstubAllGlobals());

/** Resolves the plugin's own entries, as an app's test would resolve the installed package. */
const importer: Importer = async (id) => {
	const entries: Record<string, () => Promise<Record<string, unknown>>> = {
		'@xcwds/plugin-offline': () => import('./index.js'),
		'@xcwds/plugin-offline/client': () => import('./client.js'),
		'@xcwds/plugin-offline/worker': () => import('./worker.js')
	};
	const load = entries[id];
	if (!load) throw Object.assign(new Error(id), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
	return load();
};

describe('options', () => {
	it('fills in defaults and refuses mistakes', () => {
		expect(resolveOptions()).toEqual({
			precache: [],
			exclude: [],
			fallback: '/404.html',
			runtimeCaching: true,
			byApp: false
		});
		expect(() => resolveOptions({ byApp: 'yes' })).toThrow(/`byApp`/);
		expect(() => resolveOptions({ fallback: '404.html' })).toThrow(/`fallback`/);
		expect(() => resolveOptions({ precache: ['/a?b'] })).toThrow(/`precache`/);
		expect(() => resolveOptions({ exclude: 'videos' })).toThrow(/`exclude`/);
		expect(() => resolveOptions({ runtimeCaching: 'yes' })).toThrow(/`runtimeCaching`/);
		expect(() => resolveOptions({ fallbak: '/x' })).toThrow(/unknown option `fallbak`/);
	});

	it('fails the build for bad options', async () => {
		await expect(
			buildTestApp({ plugins: [offline({ fallback: 'nope' })] }, { import: importer })
		).rejects.toThrow(/@xcwds\/plugin-offline: `fallback`/);
	});
});

describe('the worker', () => {
	/** A network that serves `version` for every path, until it goes away. */
	function network() {
		const state = { online: true, version: 'v1', status: 200, requests: [] as string[] };
		return {
			state,
			answer: (request: Request) => {
				const url = new URL(request.url);
				state.requests.push(url.pathname + url.search);
				if (!state.online) throw new TypeError('Failed to fetch');
				return new Response(`${state.version} ${url.pathname}${url.search}`, {
					status: state.status
				});
			}
		};
	}

	async function boot(options: Parameters<typeof offline>[0] = {}, net = network()) {
		const sw = await buildTestWorker(
			{ plugins: [offline(options)] },
			{
				import: importer,
				base: '/sub',
				prerendered: ['/sub/', '/sub/hello'],
				build: ['/sub/_app/app.js'],
				files: ['/sub/videos/intro.mp4', '/sub/robots.txt'],
				version: '1',
				network: net.answer
			}
		);
		await sw.install();
		await sw.activate();
		return { sw, net: net.state };
	}
	const text = async (response: Promise<Response | undefined>) => (await response)?.text();
	const cached = async (sw: Awaited<ReturnType<typeof boot>>['sw']) =>
		(await sw.cache.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search).sort();

	it('precaches the build and serves it from its own version, never the network', async () => {
		const { sw, net } = await boot({ precache: ['/data.json'], exclude: ['/videos/**'] });
		expect(await cached(sw)).toEqual([
			'/sub/',
			'/sub/404.html',
			'/sub/_app/app.js',
			'/sub/data.json',
			'/sub/hello',
			'/sub/robots.txt'
		]);
		net.version = 'v2';
		net.requests.length = 0;
		expect(await text(sw.fetch('/hello'))).toBe('v1 /sub/hello');
		expect(await text(sw.fetch('/data.json'))).toBe('v1 /sub/data.json');
		expect(net.requests).toEqual([]);
		// A new version waits: nothing here makes it take over.
		expect(sw.skippedWaiting).toBe(false);
	});

	it('keeps other pages and files for offline use, but not query strings or failures', async () => {
		const { sw, net } = await boot();
		expect(await text(sw.fetch('/notes/1'))).toBe('v1 /sub/notes/1');
		expect(await text(sw.fetch('/search?q=secret'))).toBe('v1 /sub/search?q=secret');
		net.status = 500;
		expect((await sw.fetch('/broken'))?.status).toBe(500);
		expect(await cached(sw)).toContain('/sub/notes/1');
		expect((await cached(sw)).filter((p) => p.includes('search') || p.includes('broken'))).toEqual(
			[]
		);

		net.online = false;
		// Cached at runtime: still there offline.
		expect(await text(sw.fetch('/notes/1'))).toBe('v1 /sub/notes/1');
		// Never cached: navigations get the fallback page (which boots the app's error page).
		expect(await text(sw.fetch('/search?q=secret', { mode: 'navigate' }))).toBe('v1 /sub/404.html');
		await expect(sw.fetch('/broken')).rejects.toThrow('Failed to fetch');
	});

	it('never caches excluded paths, and uses the fallback page it is given', async () => {
		const { sw, net } = await boot({ exclude: ['/videos/**', '/private'], fallback: '/offline' });
		expect(await cached(sw)).toContain('/sub/offline');
		expect(await cached(sw)).not.toContain('/sub/videos/intro.mp4');
		expect(await text(sw.fetch('/videos/intro.mp4'))).toBe('v1 /sub/videos/intro.mp4');
		expect(await text(sw.fetch('/private'))).toBe('v1 /sub/private');
		expect(await cached(sw)).not.toContain('/sub/private');
		net.online = false;
		await expect(sw.fetch('/videos/intro.mp4')).rejects.toThrow('Failed to fetch');
		expect(await text(sw.fetch('/private', { mode: 'navigate' }))).toBe('v1 /sub/offline');
	});

	it("doesn't cache at runtime when told not to", async () => {
		const { sw, net } = await boot({ runtimeCaching: false });
		await sw.fetch('/notes/1');
		net.online = false;
		expect(await text(sw.fetch('/notes/1', { mode: 'navigate' }))).toBe('v1 /sub/404.html');
	});

	it('serves the response even when caching it fails', async () => {
		const sw = await buildTestWorker(
			{ plugins: [[worker, {}]] },
			{
				logLevel: 'silent',
				network: () => new Response('varies', { headers: { vary: '*' } })
			}
		);
		expect(await text(sw.fetch('/x'))).toBe('varies');
		expect(await sw.cache.keys()).toEqual([]);
	});

	it("deletes the previous versions' caches when it activates, and only its app's", async () => {
		const sw = await buildTestWorker({ plugins: [[worker, {}]] }, { version: '2' });
		const own = sw.app.worker!.cacheName;
		const previous = own.replace(/2$/, '1');
		await sw.caches.open(previous);
		await sw.caches.open('another-app');
		await sw.install();
		await sw.activate();
		expect((await sw.caches.keys()).sort()).toEqual([own, 'another-app'].sort());
	});
});

describe('byApp', () => {
	/** `@xcwds/plugin-tools`' worker entry as far as this plugin reads it: three apps. */
	const APPS = [
		{ id: 'kitchen', pages: ['/kitchen', '/kitchen/coffee'] },
		{ id: 'hello', pages: ['/hello'] },
		{ id: 'secret', pages: ['/secret'], default: false }
	];
	const tools = definePlugin(
		(app) => {
			app.decorate('tools', {
				apps: () => APPS,
				appOf: (path: string) =>
					APPS.find((a) => a.pages.some((p) => path === p || path.startsWith(`${p}/`)))
			});
		},
		{ name: 'fake-tools', encapsulate: false }
	);

	function network() {
		const state = { online: true, version: 'v1' };
		return {
			state,
			answer: (request: Request) => {
				if (!state.online) throw new TypeError('Failed to fetch');
				return new Response(`${state.version} ${new URL(request.url).pathname}`);
			}
		};
	}

	async function boot(
		net = network(),
		{
			version = '1',
			seed,
			older = false,
			activate = true
		}: { version?: string; seed?: Response; older?: boolean; activate?: boolean } = {}
	) {
		const sw = await buildTestWorker(
			{ plugins: [[tools, {}], offline({ byApp: true })] },
			{
				import: importer,
				base: '/sub',
				prerendered: ['/sub/', '/sub/kitchen', '/sub/kitchen/coffee', '/sub/hello', '/sub/secret'],
				build: ['/sub/_app/app.js'],
				version,
				network: net.answer
			}
		);
		if (seed) await (await savedCache(sw)).put(savedKey(sw), seed);
		// What an installed older version leaves: its cache, deleted when this one activates.
		if (older) await sw.caches.open(sw.app.worker!.cacheName.replace(/[^:]+$/, 'old'));
		await sw.install();
		if (activate) await sw.activate();
		return { sw, net: net.state };
	}
	type Worker = Awaited<ReturnType<typeof boot>>['sw'];
	const savedCache = (sw: Worker) => sw.caches.open(appsCacheName(sw.app.worker!.scope));
	const savedKey = (sw: Worker) => new URL('.xcwds-offline/apps.json', sw.app.worker!.scope).href;
	const cached = async (sw: Worker) =>
		(await sw.cache.keys()).map((r) => new URL(r.url).pathname).sort();
	const on = (sw: Worker, ...ids: string[]) => sw.message({ type: APPS_MESSAGE, on: ids });

	afterEach(() => void vi.restoreAllMocks());

	it('a first install keeps the shared pages and the apps that start on, not the others', async () => {
		const { sw } = await boot();
		expect(await cached(sw)).toEqual([
			'/sub/',
			'/sub/404.html',
			'/sub/_app/app.js',
			'/sub/hello',
			'/sub/kitchen',
			'/sub/kitchen/coffee'
		]);
		expect(await sw.app.worker!.deferred()).toEqual([
			'/sub/kitchen',
			'/sub/kitchen/coffee',
			'/sub/hello',
			'/sub/secret'
		]);
	});

	it('downloads an app turned on, deletes one turned off, and serves its pages offline', async () => {
		const { sw, net } = await boot();
		await on(sw, 'kitchen', 'secret');
		expect(await cached(sw)).toContain('/sub/secret');
		expect(await cached(sw)).not.toContain('/sub/hello');
		net.version = 'v2';
		// From this version's cache, not the network, like the precached pages.
		expect(await (await sw.fetch('/secret'))?.text()).toBe('v1 /sub/secret');
		net.online = false;
		expect(await (await sw.fetch('/kitchen/coffee'))?.text()).toBe('v1 /sub/kitchen/coffee');
		// Turned off: gone, so offline it gets the fallback page.
		await expect(sw.fetch('/hello')).rejects.toThrow('Failed to fetch');
		expect(await (await sw.fetch('/hello', { mode: 'navigate' }))?.text()).toBe('v1 /sub/404.html');
	});

	it('keeps a page of an app that is off once it was visited, until the app goes on and off', async () => {
		const { sw, net } = await boot();
		await on(sw, 'kitchen', 'hello');
		expect(await (await sw.fetch('/secret'))?.text()).toBe('v1 /sub/secret');
		// The page says the same again (another tab, a reload): nothing visited is dropped.
		await on(sw, 'kitchen', 'hello');
		expect(await cached(sw)).toContain('/sub/secret');
		await on(sw, 'kitchen', 'hello', 'secret');
		await on(sw, 'kitchen', 'hello');
		expect(await cached(sw)).not.toContain('/sub/secret');
		net.online = false;
		await expect(sw.fetch('/secret')).rejects.toThrow('Failed to fetch');
	});

	it('an update precaches the apps that were on, so they keep working offline', async () => {
		const first = await boot();
		await on(first.sw, 'secret');
		const saved = await (await savedCache(first.sw)).match(savedKey(first.sw));
		expect(await saved!.clone().json()).toEqual(['secret']);
		await first.sw.close();

		const net = network();
		net.state.version = 'v2';
		const { sw } = await boot(net, { version: '2', seed: saved });
		expect(await cached(sw)).toEqual(['/sub/', '/sub/404.html', '/sub/_app/app.js', '/sub/secret']);
	});

	it('an update from a version without byApp keeps every app, as that version did', async () => {
		const { sw } = await boot(network(), { older: true });
		expect(await cached(sw)).toContain('/sub/secret');
		expect(await cached(sw)).toContain('/sub/hello');
		// The page's first message then drops the apps that are off, whatever their default.
		await on(sw, 'kitchen', 'hello');
		expect(await cached(sw)).not.toContain('/sub/secret');
		expect(await cached(sw)).toContain('/sub/hello');
	});

	it('catches up on apps turned on or off while it waited, when it takes over', async () => {
		const { sw } = await boot(network(), {
			seed: new Response(JSON.stringify(['kitchen', 'hello'])),
			activate: false
		});
		// The old version, still in control, got the message and saved it.
		await (
			await savedCache(sw)
		).put(savedKey(sw), new Response(JSON.stringify(['kitchen', 'secret'])));
		await sw.activate();
		expect(await cached(sw)).toContain('/sub/secret');
		expect(await cached(sw)).not.toContain('/sub/hello');
	});

	it('takes over even when it cannot catch up, and says why', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const net = network();
		const { sw } = await boot(net, { seed: new Response('["kitchen"]'), activate: false });
		await (await savedCache(sw)).put(savedKey(sw), new Response('["secret"]'));
		net.state.online = false;
		await sw.activate();
		expect(await cached(sw)).not.toContain('/sub/secret');
		expect(warn.mock.calls.flat().join(' ')).toMatch(/couldn't download the apps that are on/);
	});

	it('an update fails rather than leave out an app that was on', async () => {
		const net = network();
		net.state.online = false;
		await expect(boot(net, { seed: new Response(JSON.stringify(['hello'])) })).rejects.toThrow(
			'Failed to fetch'
		);
	});

	it('ignores other messages and apps it does not know', async () => {
		const { sw } = await boot();
		await sw.message({ type: APPS_MESSAGE, on: 'kitchen' });
		await sw.message({ type: 'other', on: [] });
		expect(await cached(sw)).toContain('/sub/hello');
		await on(sw, 'nope', 'kitchen');
		expect(await (await (await savedCache(sw)).match(savedKey(sw)))!.json()).toEqual(['kitchen']);
		expect(await cached(sw)).not.toContain('/sub/hello');
	});

	it('a page that failed to download is fetched again with the next message', async () => {
		const { sw, net } = await boot();
		net.online = false;
		await expect(on(sw, 'secret')).rejects.toThrow('Failed to fetch');
		net.online = true;
		await on(sw, 'secret');
		expect(await cached(sw)).toContain('/sub/secret');
	});

	it('without @xcwds/plugin-tools, warns and precaches every page', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const sw = await buildTestWorker(
			{ plugins: [offline({ byApp: true })] },
			{ import: importer, prerendered: ['/', '/hello'], network: network().answer }
		);
		await sw.install();
		expect((await sw.cache.keys()).map((r) => new URL(r.url).pathname).sort()).toEqual([
			'/',
			'/404.html',
			'/hello'
		]);
		expect(warn.mock.calls.flat().join(' ')).toMatch(/`byApp` needs @xcwds\/plugin-tools/);
	});
});

describe('the network status', () => {
	it('follows the browser once the app boots', async () => {
		const events = new EventTarget();
		vi.stubGlobal('window', events);
		vi.stubGlobal('navigator', { onLine: false });
		const app = await buildTestApp({ plugins: [[client, {}]] });
		const seen: boolean[] = [];
		app.network!.subscribe((online) => seen.push(online));
		expect(app.network!.online).toBe(false);
		events.dispatchEvent(new Event('online'));
		events.dispatchEvent(new Event('offline'));
		await app.close();
		events.dispatchEvent(new Event('online'));
		expect(seen).toEqual([false, true, false]);
	});

	it('loads from the config with its build entry', async () => {
		vi.stubGlobal('window', new EventTarget());
		vi.stubGlobal('navigator', { onLine: true });
		const app = await buildTestApp(
			{ brand: { name: 'Offline' }, plugins: [offline()] },
			{ import: importer }
		);
		expect(app.network!.online).toBe(true);
	});
});
