import { buildTestApp, type Importer } from '@xcwds/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import client from './client.js';
import shell from './index.js';
import { activeSection, pageInfo } from './nav.js';
import { APPLY_NAV, DEFAULT_NAV, applyNav, parseNav, resolveOptions } from './options.js';

afterEach(() => void vi.unstubAllGlobals());

const importer: Importer = async (id) => {
	const entries: Record<string, () => Promise<Record<string, unknown>>> = {
		'@xcwds/plugin-shell': () => import('./index.js'),
		'@xcwds/plugin-shell/client': () => import('./client.js')
	};
	const load = entries[id];
	if (!load) throw Object.assign(new Error(id), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
	return load();
};

const sections = [
	{ path: '/', label: 'Home', emoji: '🏠' },
	{ path: '/recipes', label: 'Recipes', emoji: '📖', also: ['/guide'] },
	{ path: '/utils', label: 'Utils', emoji: '🧰' },
	{ path: '/settings', label: 'Settings', emoji: '⚙️' }
];

describe('options', () => {
	it('fills in defaults and refuses mistakes', () => {
		expect(resolveOptions()).toEqual({ sections: [{ path: '/', label: 'Home', emoji: '🏠' }] });
		expect(resolveOptions({ sections })).toEqual({ sections });
		expect(() => resolveOptions({ sections: [] })).toThrow(/non-empty/);
		expect(() => resolveOptions({ sections: [{ path: 'x', label: 'X' }] })).toThrow(
			/`sections\[0\]`.path/
		);
		expect(() => resolveOptions({ sections: [{ path: '/x/', label: 'X' }] })).toThrow(/path/);
		expect(() => resolveOptions({ sections: [{ path: '/x', label: '' }] })).toThrow(/label/);
		expect(() => resolveOptions({ sections: [{ path: '/x', label: 'X', also: ['/'] }] })).toThrow(
			/also/
		);
		expect(() =>
			resolveOptions({
				sections: [
					{ path: '/a', label: 'A', also: ['/b'] },
					{ path: '/b', label: 'B' }
				]
			})
		).toThrow(/already has/);
		expect(() => resolveOptions({ sections: [{ path: '/x', label: 'X', icon: 'y' }] })).toThrow(
			/unknown key `icon`/
		);
		expect(() => resolveOptions({ tabs: [] })).toThrow(/unknown option `tabs`/);
	});

	it('fails the build for bad options', async () => {
		await expect(
			buildTestApp({ plugins: [shell({ sections: [] })] }, { import: importer })
		).rejects.toThrow(/@xcwds\/plugin-shell: `sections`/);
	});
});

describe('navigation', () => {
	it('finds the section a path belongs to', () => {
		expect(activeSection(sections, '/')).toBe('/');
		expect(activeSection(sections, '/recipes')).toBe('/recipes');
		expect(activeSection(sections, '/recipes/banana-bread/')).toBe('/recipes');
		expect(activeSection(sections, '/guide/beef')).toBe('/recipes');
		expect(activeSection(sections, '/utilsx')).toBe('/');
		expect(activeSection(sections, '/elsewhere')).toBe('/');
		// The longest claim wins.
		expect(
			activeSection(
				[
					{ path: '/a', label: 'A' },
					{ path: '/b', label: 'B', also: ['/a/deep'] }
				],
				'/a/deep/page'
			)
		).toBe('/b');
	});

	const routes: Record<
		string,
		{ title: string; emoji?: string; parent?: string; width?: 'narrow' | 'wide' | 'split' }
	> = {
		'/utils/timer': { title: 'Timer', emoji: '⏱️', parent: '/utils', width: 'narrow' },
		'/guide': { title: 'Kitchen Guide' },
		'/guide/beef': { title: 'Beef', parent: '/guide' }
	};
	const info = (path: string, error?: number) =>
		pageInfo(path, {
			sections,
			route: (p) => (routes[p] ? { ...routes[p], path: p, plugin: '' } : undefined),
			appName: 'My app',
			error
		});

	it('titles pages from the route registry, then sections, then the app', () => {
		expect(info('/')).toEqual({ title: 'My app', width: 'wide' });
		expect(info('/utils/')).toEqual({ title: 'Utils', emoji: '🧰', width: 'wide' });
		expect(info('/utils/timer')).toEqual({
			title: 'Timer',
			emoji: '⏱️',
			parent: '/utils',
			parentLabel: 'Utils',
			width: 'narrow'
		});
		expect(info('/guide/beef')).toMatchObject({ parent: '/guide', parentLabel: 'Kitchen Guide' });
		expect(info('/somewhere')).toEqual({
			title: 'My app',
			parent: '/',
			parentLabel: 'Home',
			width: 'wide'
		});
	});

	it('titles error pages and leads home', () => {
		expect(info('/nope', 404)).toEqual({
			title: 'Page not found',
			parent: '/',
			parentLabel: 'Home',
			width: 'narrow'
		});
		expect(info('/utils/timer', 500).title).toBe('Something went wrong');
	});
});

describe('the nav setting', () => {
	it('falls back per half and applies the same way before and after paint', () => {
		expect(parseNav(undefined)).toBeUndefined();
		expect(parseNav({ portrait: 'sidebar' })).toEqual({
			portrait: 'sidebar',
			landscape: 'sidebar'
		});
		expect(parseNav({ portrait: 'x', landscape: 'bar' })).toEqual({
			portrait: 'bar',
			landscape: 'bar'
		});

		for (const saved of [
			undefined,
			'junk',
			{ portrait: 'sidebar', landscape: 'bar' },
			{ landscape: 1 }
		]) {
			const prePaint = new Map<string, string>();
			const page = new Map<string, string>();
			new Function('v', 'root', APPLY_NAV)(saved, {
				setAttribute: (k: string, v: string) => void prePaint.set(k, v)
			});
			applyNav(parseNav(saved) ?? DEFAULT_NAV, {
				setAttribute: (k: string, v: string) => void page.set(k, v)
			} as never);
			expect(page, JSON.stringify(saved)).toEqual(prePaint);
		}
	});

	it('applies on boot and on change', async () => {
		const attributes = new Map<string, string>();
		vi.stubGlobal('document', {
			documentElement: { setAttribute: (k: string, v: string) => void attributes.set(k, v) }
		});
		const app = await buildTestApp({ plugins: [[client, {}]] });
		expect(Object.fromEntries(attributes)).toEqual({
			'data-nav-portrait': 'bar',
			'data-nav-landscape': 'sidebar'
		});
		app.settings.set({ nav: { portrait: 'sidebar', landscape: 'bar' } });
		expect(attributes.get('data-nav-landscape')).toBe('bar');
		expect(app.settings.fields()).toContainEqual(
			expect.objectContaining({ name: 'nav', section: 'appearance' })
		);
	});
});

describe('app.shell and app.toast', () => {
	function stubDocument() {
		vi.stubGlobal('document', { documentElement: { setAttribute() {} } });
	}

	it('has the sections and slots other plugins add to, in order', async () => {
		stubDocument();
		const app = await buildTestApp({ plugins: [[client, { sections }]] });
		expect(app.shell!.sections).toEqual(sections);
		const a = (() => {}) as never;
		const b = (() => {}) as never;
		const c = (() => {}) as never;
		const seen: unknown[][] = [];
		app.shell!.home.subscribe((list) => seen.push(list.map((s) => s.component)));
		app.shell!.home.add(a, { order: 10 });
		const removeB = app.shell!.home.add(b, { props: { n: 1 } });
		app.shell!.home.add(c, { order: 10 });
		expect(app.shell!.home.list().map((s) => s.component)).toEqual([b, a, c]);
		expect(app.shell!.home.list()[0]!.props).toEqual({ n: 1 });
		removeB();
		expect(app.shell!.home.list().map((s) => s.component)).toEqual([a, c]);
		expect(seen.length).toBe(5);
		expect(app.shell!.header.list()).toEqual([]);
	});

	it('shows toasts for a while, at most three, and dismisses them', async () => {
		stubDocument();
		const app = await buildTestApp({ plugins: [[client, {}]] }, { now: new Date('2026-01-01') });
		const clock = app.clock!;
		const messages = () => app.shell!.toasts.list().map((t) => t.message);
		app.toast!('one');
		app.toast!('two', { action: { label: 'See', path: '/settings', hash: '#x' } });
		expect(messages()).toEqual(['one', 'two']);
		await clock.advance(3000);
		expect(messages()).toEqual(['two']);
		await clock.advance(5000);
		expect(messages()).toEqual([]);

		for (const m of ['a', 'b', 'c', 'd']) app.toast!(m);
		expect(messages()).toEqual(['b', 'c', 'd']);
		app.shell!.toasts.dismiss(app.shell!.toasts.list()[0]!.id);
		expect(messages()).toEqual(['c', 'd']);
		app.toast!('long', { durationMs: 10_000 });
		await clock.advance(3000);
		expect(messages()).toEqual(['long']);
	});

	it('records the page a toast was raised on', async () => {
		stubDocument();
		const app = await buildTestApp({ plugins: [[client, {}]] });
		app.toast!('at home');
		await app.hooks.run('afterNavigate', [{ path: '/journal' }], { path: '/journal' });
		app.toast!('on the journal');
		expect(app.shell!.toasts.list().map((t) => t.path)).toEqual(['/', '/journal']);
	});
});
