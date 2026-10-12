import { createApp, definePlugin, memoryStorage, XcwdsError } from '@xcwds/core';
import { describe, expect, it } from 'vitest';
import {
	MAX_REDIRECTS,
	askGuards,
	createRoutes,
	decide,
	decorateRoutes,
	normalizePath,
	routeOf,
	setupApp,
	stripBase,
	workerPath
} from './routes.js';

describe('paths', () => {
	it('normalises paths and strips the base path', () => {
		expect(normalizePath('/a/b/')).toBe('/a/b');
		expect(normalizePath('')).toBe('/');
		expect(normalizePath('//a//b')).toBe('/a/b');
		expect(stripBase('/sub/hello', '/sub')).toBe('/hello');
		expect(stripBase('/sub', '/sub')).toBe('/');
		expect(stripBase('/subway', '/sub')).toBeNull();
		expect(stripBase('/hello', '')).toBe('/hello');
	});
});

describe('the route registry', () => {
	it('adds routes under a prefix and finds them with or without a trailing slash', () => {
		const routes = createRoutes();
		routes.add({ path: '/', title: 'Timer', parent: '/utils/' }, 'timers', '/utils/timer');
		expect(routes.get('/utils/timer/')).toEqual({
			path: '/utils/timer',
			title: 'Timer',
			parent: '/utils',
			plugin: 'timers'
		});
		expect(routes.list()).toHaveLength(1);
		expect(createRoutes(routes.list()).get('/utils/timer')?.plugin).toBe('timers');
	});

	it('rejects invalid and duplicate routes, naming the plugins', () => {
		const routes = createRoutes();
		routes.add({ path: '/a', title: 'A' }, 'one');
		expect(() => routes.add({ path: '/a/', title: 'B' }, 'two')).toThrow(
			'The route "/a" from "two" is already added by "one".'
		);
		expect(() => routes.add({ path: 'a', title: 'A' })).toThrow(XcwdsError);
		expect(() => routes.add({ path: '/b?x=1', title: 'B' })).toThrow('query or hash');
		expect(() => routes.add({ path: '/b', title: ' ' })).toThrow('needs a title');
		expect(() => routes.add({ path: '/b', title: 'B', width: 'huge' as never })).toThrow(
			'"narrow", "wide" or "split"'
		);
		expect(() => routes.add({ path: '/b', title: 'B', parent: 'x' })).toThrow('parent');
		expect(() => routes.add({ path: '/b', title: 'B', private: 'yes' as never })).toThrow(
			'private of "/b"'
		);
	});

	it("records each plugin's name and prefix through app.route()", async () => {
		const app = createApp({ storage: memoryStorage(), logLevel: 'silent' });
		decorateRoutes(app);
		app.register(
			definePlugin((a) => void a.route({ path: '/', title: 'Timer', emoji: '⏱️' }), {
				name: '@xcwds/plugin-timers'
			}),
			{ prefix: '/utils/timer' }
		);
		app.register(definePlugin((a) => void a.route({ path: '/about', title: 'About' })));
		await app.ready();
		expect(app.routes.list().map((r) => [r.path, r.plugin])).toEqual([
			['/utils/timer', '@xcwds/plugin-timers'],
			['/about', 'anonymous plugin']
		]);
	});
});

describe('the shared navigation core', () => {
	const target = new URL('http://x/sub/hello/?q=1');

	it('turns URLs into routes, keeping the path as written', () => {
		expect(routeOf(target, '/sub')).toEqual({ path: '/hello/', url: target });
		expect(routeOf(new URL('http://x/other'), '/sub')).toBeNull();
	});

	it('decides what guards answers mean', () => {
		const base = '/sub';
		expect(decide(undefined, { target, base, redirects: 0 })).toEqual({ action: 'allow' });
		expect(decide(false, { target, base, redirects: 0 })).toEqual({ action: 'cancel' });
		expect(decide(false, { target, base, redirects: 0, first: true })).toEqual({
			action: 'allow'
		});
		expect(decide('/a?b', { target, base, redirects: 2 })).toEqual({
			action: 'redirect',
			url: new URL('http://x/sub/a?b'),
			redirects: 3
		});
		const stop = decide('/a', { target, base, redirects: MAX_REDIRECTS });
		expect(stop).toMatchObject({ action: 'stop' });
		expect(stop.action === 'stop' && stop.error.message).toMatch(
			/more than 5 times; stopped at \/a/
		);
	});

	it("stops at guard answers that aren't app paths", () => {
		const base = '/sub';
		for (const answer of [
			'//evil.example/x',
			'/\\evil.example/x',
			'https://evil.example/',
			'a',
			''
		])
			for (const b of [base, '']) {
				const decision = decide(answer, { target, base: b, redirects: 0 });
				expect(decision, `${b} ${answer}`).toMatchObject({ action: 'stop' });
				expect(decision.action === 'stop' && decision.error.message).toMatch(/isn't an app path/);
			}
		expect(decide('/a', { target, base: '', redirects: 0 })).toMatchObject({
			action: 'redirect',
			url: new URL('http://x/a')
		});
	});

	it('runs guards synchronously when they answer synchronously', async () => {
		const app = setupApp({
			name: 'T',
			storagePrefix: 'app:',
			routes: [{ path: '/t', title: 'T', plugin: '' }],
			plugins: [
				[(a) => void a.addHook('onNavigate', (to) => (to.path === '/t' ? '/u' : undefined)), {}]
			],
			storage: memoryStorage(),
			logLevel: 'silent'
		});
		await app.ready();
		expect(app.routes.get('/t')?.title).toBe('T');
		expect(askGuards(app, { path: '/t' }, null)).toBe('/u');
		await app.close();
	});

	it('picks the requests the worker handles', () => {
		const get = (url: string, method = 'GET') => new Request(url, { method });
		expect(workerPath(get('http://x/sub/a'), 'http://x', '/sub')).toBe('/a');
		expect(workerPath(get('http://x/a'), 'http://x', '/sub')).toBeNull();
		expect(workerPath(get('http://y/sub/a'), 'http://x', '/sub')).toBeNull();
		expect(workerPath(get('http://x/sub/a', 'POST'), 'http://x', '/sub')).toBeNull();
	});
});
