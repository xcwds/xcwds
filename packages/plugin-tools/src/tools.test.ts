import { createApp, definePlugin, memoryStorage, type StorageAdapter } from '@xcwds/core';
import shellClient from '@xcwds/plugin-shell/client';
import { decorateRoutes } from '@xcwds/sveltekit/routes';
import { buildTestApp, type Importer } from '@xcwds/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import client from './client.js';
import {
	MAX_RECENT,
	emptyShortcuts,
	parseShortcuts,
	withPinMoved,
	withPinToggled,
	withVisit,
	withoutTool,
	type ShortcutTool
} from './home.js';
import toolsFactory, { build } from './index.js';
import { appIsOn, appOf, applyAppsScript, appsOff, parseAppsSetting, withAppOn } from './apps.js';
import {
	checkTool,
	isToolPath,
	resolveOptions,
	splitToolPath,
	type AppGroup,
	type Tool
} from './options.js';

// The block needs SvelteKit's runtime; e2e tests cover it.
vi.mock('./HomeShortcuts.svelte', () => ({ default: function HomeShortcuts() {} }));

const importer: Importer = async (id) => {
	const entries: Record<string, () => Promise<Record<string, unknown>>> = {
		'@xcwds/plugin-tools': () => import('./index.js'),
		'@xcwds/plugin-tools/client': () => import('./client.js')
	};
	const load = entries[id];
	if (!load) throw Object.assign(new Error(id), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
	return load();
};

const tool = (name: string, extra: Partial<Tool> = {}): Tool => ({
	path: `/utils/${name}`,
	name: name.toUpperCase(),
	emoji: '🔧',
	blurb: `The ${name} tool.`,
	...extra
});

const items = [
	tool('a'),
	tool('b', { shortcut: true }),
	tool('c'),
	tool('d'),
	tool('private', { private: true })
];
const options = { path: '/utils', title: 'Utils', items };

describe('options', () => {
	it('fills in defaults and refuses mistakes', async () => {
		expect(resolveOptions()).toEqual({
			path: '/tools',
			title: 'Tools',
			emoji: undefined,
			items: [],
			apps: [],
			catalog: '/apps'
		});
		expect(resolveOptions(options).items).toEqual(items);
		expect(() => resolveOptions({ path: '/' })).toThrow(/`path`/);
		expect(() => resolveOptions({ path: '/utils/' })).toThrow(/`path`/);
		expect(() => resolveOptions({ title: ' ' })).toThrow(/`title`/);
		expect(() => resolveOptions({ items: {} })).toThrow(/`items`/);
		expect(() => resolveOptions({ items: [{ ...tool('a'), path: 'a' }] })).toThrow(/`items\[0\]`/);
		expect(() => resolveOptions({ items: [{ ...tool('a'), blurb: '' }] })).toThrow(
			/"\/utils\/a" needs a `blurb`/
		);
		expect(() => resolveOptions({ items: [{ ...tool('a'), private: 'yes' }] })).toThrow(
			/`private`/
		);
		expect(() => resolveOptions({ items: [tool('a', { private: true, shortcut: true })] })).toThrow(
			/private, so it can't be a manifest shortcut/
		);
		expect(() => resolveOptions({ items: [tool('a'), tool('a')] })).toThrow(/two tools/);
		expect(() => resolveOptions({ path: '/utils/a', items: [tool('a')] })).toThrow(
			/index page's path/
		);
		expect(() => resolveOptions({ items: [{ ...tool('a'), recents: false }] })).toThrow(
			/unknown key `recents`/
		);
		expect(() => resolveOptions({ items: [tool('a', { width: 'full' } as never)] })).toThrow(
			/`width`/
		);
		for (const width of ['wide', 'split'] as const)
			expect(resolveOptions({ items: [tool('a', { width })] }).items[0]!.width).toBe(width);
		expect(resolveOptions({ items: [tool('a', { width: 'narrow' })] }).items[0]!.width).toBe(
			undefined
		);
		expect(() => resolveOptions({ tools: [] })).toThrow(/unknown option `tools`/);
		expect(resolveOptions({ storageKey: 'app:home:shortcuts' }).storageKey).toBe(
			'app:home:shortcuts'
		);
		expect(() => resolveOptions({ storageKey: 'shortcuts' })).toThrow(/`storageKey`/);
		expect(() => resolveOptions({ storageKey: 'app:home shortcuts' })).toThrow(/`storageKey`/);
		await expect(
			buildTestApp({ plugins: [toolsFactory({ path: 'utils' })] }, { import: importer })
		).rejects.toThrow(/@xcwds\/plugin-tools: `path`/);
	});
});

// Ported from xcwds.github.io's home.spec.ts.
const kitchen: AppGroup = {
	id: 'kitchen',
	name: 'Kitchen',
	emoji: '🍳',
	blurb: 'Cooking.',
	routes: ['/recipes'],
	groups: ['recipes']
};
const games: AppGroup = { id: 'games', name: 'Games', emoji: '🎲', blurb: 'Play.', default: false };
const secret: AppGroup = {
	id: 'secret',
	name: 'Notes',
	emoji: '📓',
	blurb: 'Mine.',
	private: true
};
const withApps = {
	path: '/utils',
	title: 'Utils',
	apps: [kitchen, games, secret],
	items: [
		tool('a', { app: 'kitchen', shortcut: true }),
		tool('b', { app: 'games', shortcut: true }),
		tool('c'),
		tool('s', { app: 'secret' })
	]
};

describe('apps (#158)', () => {
	it('checks apps and the tools in them', () => {
		const resolved = resolveOptions(withApps);
		expect(resolved.apps).toEqual([kitchen, games, secret]);
		// A tool in a private app is private.
		expect(resolved.items.find((t) => t.path === '/utils/s')?.private).toBe(true);
		const bad =
			(apps: unknown, items: unknown[] = []) =>
			() =>
				resolveOptions({ path: '/utils', apps, items });
		expect(bad([{ ...kitchen, colour: 'red' }])).toThrow(/unknown key `colour`/);
		expect(bad([{ ...kitchen, id: 'Kitchen' }])).toThrow(/`id`/);
		expect(bad([{ ...kitchen, blurb: '' }])).toThrow(/needs a `blurb`/);
		expect(bad([{ ...kitchen, default: 'yes' }])).toThrow(/`default`/);
		expect(bad([{ ...kitchen, routes: ['recipes'] }])).toThrow(/`routes`/);
		expect(bad([{ ...kitchen, groups: [''] }])).toThrow(/`groups`/);
		expect(bad([kitchen, kitchen])).toThrow(/two apps with the id "kitchen"/);
		expect(bad([kitchen], [tool('x', { app: 'garden' })])).toThrow(/app "garden"/);
		expect(bad([secret], [tool('x', { app: 'secret', shortcut: true })])).toThrow(/private app/);
		expect(bad([kitchen], [{ ...tool('x'), path: '/apps' }])).toThrow(/Apps page/);
		expect(() => resolveOptions({ path: '/utils', catalog: '/utils' })).toThrow(/`catalog`/);
		// Without apps, a tool may use the path; there's no Apps page.
		expect(() => resolveOptions({ items: [{ ...tool('x'), path: '/apps' }] })).not.toThrow();
	});

	it('read the setting: what the person chose, else the default', () => {
		expect(parseAppsSetting('on')).toBeUndefined();
		expect(parseAppsSetting({ kitchen: false, games: 'yes', gone: true })).toEqual({
			kitchen: false,
			gone: true
		});
		const apps = [kitchen, games];
		expect(appIsOn(apps, {}, 'kitchen')).toBe(true);
		expect(appIsOn(apps, {}, 'games')).toBe(false);
		expect(appIsOn(apps, { kitchen: false, games: true }, 'kitchen')).toBe(false);
		expect(appIsOn(apps, { games: true }, 'games')).toBe(true);
		expect(appIsOn(apps, { nope: true }, 'nope')).toBe(false);
		// Choosing the default forgets the choice, so a new default still applies.
		expect(withAppOn(apps, {}, 'kitchen', false)).toEqual({ kitchen: false });
		expect(withAppOn(apps, { kitchen: false }, 'kitchen', true)).toEqual({});
		expect(withAppOn(apps, { kitchen: false }, 'games', true)).toEqual({
			kitchen: false,
			games: true
		});
	});

	it('mark the apps that are off on <html>, before first paint as on the page (#159)', () => {
		const apps = [kitchen, games, secret];
		const run = new Function('v', 'root', applyAppsScript(apps));
		for (const saved of [
			undefined,
			null,
			'junk',
			{},
			{ kitchen: false },
			{ games: true, secret: false },
			{ kitchen: 'no', games: 1 }
		]) {
			const attributes = new Map<string, string>();
			run(saved, { setAttribute: (k: string, v: string) => void attributes.set(k, v) });
			const page = appsOff(apps, parseAppsSetting(saved) ?? {}).join(' ');
			expect(attributes.get('data-apps-off'), JSON.stringify(saved)).toBe(page);
		}
		expect(appsOff(apps, {})).toEqual(['games']);
	});

	it('find the app a page belongs to', () => {
		const deeper: AppGroup = { ...games, routes: ['/recipes/games'] };
		const tools = resolveOptions(withApps).items;
		expect(appOf([kitchen, deeper], tools, '/utils/a')?.id).toBe('kitchen');
		expect(appOf([kitchen, deeper], tools, '/utils/c')).toBeUndefined();
		expect(appOf([kitchen, deeper], tools, '/recipes')?.id).toBe('kitchen');
		expect(appOf([kitchen, deeper], tools, '/recipes/pie/')?.id).toBe('kitchen');
		expect(appOf([kitchen, deeper], tools, '/recipes/games/chess')?.id).toBe('games');
		expect(appOf([kitchen, deeper], tools, '/recipesbook')).toBeUndefined();
		expect(appOf([kitchen, deeper], tools, '/')).toBeUndefined();
	});

	it('adds the Apps page, and only shortcuts of apps that start on', async () => {
		const builder = createApp();
		decorateRoutes(builder);
		builder.register(build, withApps);
		await builder.ready();
		expect(builder.routes.get('/apps')).toMatchObject({ title: 'Apps', parent: '/utils' });
		expect(builder.routes.get('/utils/s')?.private).toBe(true);
		expect(builder.tools!.catalog).toBe('/apps');
		expect(builder.tools!.isOn('games')).toBe(false);
		expect(builder.tools!.appOf('/recipes/x')?.id).toBe('kitchen');
		const manifest = await builder.hooks.reduce('onManifest', { name: 'A' });
		expect(manifest.shortcuts).toEqual([
			{ name: 'A', description: 'The a tool.', url: '/utils/a' }
		]);

		// The shell registered first: its sections' apps must be ours (#159).
		const withShell = (app: string) => {
			const a = createApp();
			decorateRoutes(a);
			a.register(
				definePlugin((p) => void p.decorate('shellSections', [{ path: '/k', label: 'K', app }]), {
					encapsulate: false
				})
			);
			a.register(build, withApps);
			return a.ready();
		};
		await expect(withShell('garden')).rejects.toThrow(/section "\/k" is in the app "garden"/);
		await expect(withShell('kitchen')).resolves.toBeDefined();

		const plain = createApp();
		decorateRoutes(plain);
		plain.register(build, options);
		await plain.ready();
		expect(plain.routes.get('/apps')).toBeUndefined();
		expect(plain.tools!.catalog).toBeUndefined();
	});
});

describe('the Home rules', () => {
	const rules: ShortcutTool[] = [
		{ path: '/utils/a' },
		{ path: '/utils/b' },
		{ path: '/utils/c' },
		{ path: '/utils/d' },
		{ path: '/utils/private', private: true }
	];

	it('keep the most recent tools first, without duplicates, at most MAX_RECENT', () => {
		let s = emptyShortcuts();
		for (const p of ['/utils/a', '/utils/b', '/utils/a', '/utils/c', '/utils/d'])
			s = withVisit(s, p, rules);
		expect(s.recent).toEqual(['/utils/d', '/utils/c', '/utils/a']);
		expect(s.recent).toHaveLength(MAX_RECENT);
	});

	it('ignore pages that are not tools, and private tools', () => {
		const s = emptyShortcuts();
		expect(withVisit(s, '/recipes/brownies', rules)).toBe(s);
		expect(withVisit(s, '/utils/private', rules)).toBe(s);
	});

	it('toggle and move pins within bounds', () => {
		let s = withPinToggled(withPinToggled(emptyShortcuts(), '/utils/a'), '/utils/b');
		expect(s.pins).toEqual(['/utils/a', '/utils/b']);
		s = withPinMoved(s, '/utils/b', -1);
		expect(s.pins).toEqual(['/utils/b', '/utils/a']);
		expect(withPinMoved(s, '/utils/b', -1)).toBe(s);
		expect(withPinMoved(s, '/utils/a', 1)).toBe(s);
		expect(withPinToggled(s, '/utils/b').pins).toEqual(['/utils/a']);
	});

	it('drop removed tools, private recents, duplicates and junk from what was saved', () => {
		expect(
			parseShortcuts(
				{
					pins: ['/utils/gone', '/utils/b', '/utils/b', 3, '/utils/private'],
					recent: ['/utils/private', '/utils/gone', '/utils/a', '/utils/b', '/utils/c', '/utils/d']
				},
				rules
			)
		).toEqual({
			pins: ['/utils/b', '/utils/private'],
			recent: ['/utils/a', '/utils/b', '/utils/c']
		});
		expect(parseShortcuts('nope', rules)).toBeUndefined();
		expect(parseShortcuts({}, rules)).toEqual(emptyShortcuts());
	});
});

describe('tools on a shared page (#160)', () => {
	it('take a short #fragment after the page', () => {
		for (const ok of ['/my-apps/app#k3f9', '/a#x', '/a/b#A-z_0.9~'])
			expect(isToolPath(ok)).toBe(true);
		for (const bad of ['/a#', '/#x', '/a/#x', '/a#b c', '/a#b#c', '/a?x#y', `/a#${'x'.repeat(65)}`])
			expect(isToolPath(bad)).toBe(false);
		expect(splitToolPath('/my-apps/app#k3f9')).toEqual({ page: '/my-apps/app', fragment: '#k3f9' });
		expect(splitToolPath('/a')).toEqual({ page: '/a', fragment: '' });
		expect(() => checkTool(tool('x', { path: '/a#b c' }))).toThrow(/short #fragment/);
	});

	it('keep saved shortcuts of tools that may not be there yet, and forget removed ones', () => {
		const known: ShortcutTool[] = [{ path: '/utils/a' }];
		expect(
			parseShortcuts(
				{
					pins: ['/apps/app#x', '/utils/gone', '/utils/a'],
					recent: ['/apps/app#y', '/utils/gone']
				},
				known
			)
		).toEqual({ pins: ['/apps/app#x', '/utils/a'], recent: ['/apps/app#y'] });
		// Once there, a private one leaves Recently used like any private tool.
		expect(
			parseShortcuts({ pins: [], recent: ['/apps/p#y'] }, [{ path: '/apps/p#y', private: true }])
		).toEqual({ pins: [], recent: [] });
		// Moving skips pins Home doesn't show.
		const shows = (p: string) => p !== '/a#hidden';
		const pins = { pins: ['/b', '/a#hidden', '/c'], recent: [] };
		expect(withPinMoved(pins, '/c', -1, shows).pins).toEqual(['/c', '/b', '/a#hidden']);
		expect(withPinMoved(pins, '/b', 1, shows).pins).toEqual(['/a#hidden', '/c', '/b']);
		expect(withPinMoved(pins, '/b', -1, shows)).toBe(pins);
		expect(withPinMoved({ pins: ['/a#hidden', '/b'], recent: [] }, '/b', -1, shows).pins).toEqual([
			'/a#hidden',
			'/b'
		]);
		expect(withoutTool({ pins: ['/a#x', '/b'], recent: ['/b', '/a#x'] }, '/a#x')).toEqual({
			pins: ['/b'],
			recent: ['/b']
		});
	});

	it('adds no route in the build: the plugin that owns the page registers it', async () => {
		const app = await buildTestApp(
			{
				plugins: [
					toolsFactory(options),
					definePlugin((a) => {
						a.route({ path: '/my-apps/app', title: 'App' });
						a.tools!.add(tool('w', { path: '/my-apps/app#water' }));
					})
				]
			},
			{ import: importer }
		);
		expect(app.routes.get('/my-apps/app')).toMatchObject({ title: 'App' });
		expect(app.tools!.get('/my-apps/app#water')?.name).toBe('W');
		expect(app.routes.get('/my-apps/app#water')).toBeUndefined();
	});
});

describe('the build', () => {
	it('adds the index page and each tool to the route registry, and shortcuts to the manifest', async () => {
		const wide = tool('list', { width: 'wide' });
		const app = await buildTestApp(
			{
				plugins: [
					toolsFactory({ ...options, emoji: '🧰', items: [...items, wide] }),
					// Another plugin adds its own tool, in its build entry and its page entry.
					definePlugin((a) => a.tools!.add(tool('extra', { shortcut: true })))
				]
			},
			{ import: importer }
		);
		expect(app.routes.get('/utils/list')?.width).toBe('wide');
		expect(app.routes.get('/utils')).toMatchObject({ title: 'Utils', emoji: '🧰', width: 'wide' });
		expect(app.routes.get('/utils/a')).toMatchObject({
			title: 'A',
			emoji: '🔧',
			parent: '/utils',
			width: 'narrow'
		});
		expect(app.routes.get('/utils/a')?.private).toBeUndefined();
		expect(app.routes.get('/utils/private')?.private).toBe(true);
		expect(app.tools!.list().map((t) => t.path)).toEqual([
			...items.map((t) => t.path),
			'/utils/list',
			'/utils/extra'
		]);

		const builder = createApp();
		decorateRoutes(builder);
		builder.register(build, options);
		builder.register(definePlugin((a) => a.tools!.add(tool('extra', { shortcut: true }))));
		await builder.ready();
		expect(builder.routes.get('/utils/extra')?.parent).toBe('/utils');
		expect(
			await builder.hooks.reduce('onManifest', {
				name: 'A',
				scope: '/sub/',
				shortcuts: [{ name: 'X', url: '/sub/x' }]
			})
		).toEqual({
			name: 'A',
			scope: '/sub/',
			shortcuts: [
				{ name: 'X', url: '/sub/x' },
				{ name: 'B', description: 'The b tool.', url: '/sub/utils/b' },
				{ name: 'EXTRA', description: 'The extra tool.', url: '/sub/utils/extra' }
			]
		});
		expect(() => builder.tools!.add({ ...tool('bad'), path: 'bad' })).toThrow(/`path`/);

		const plain = createApp();
		decorateRoutes(plain);
		plain.register(build, { items: [tool('a')] });
		await plain.ready();
		expect(await plain.hooks.reduce('onManifest', { name: 'A' })).toEqual({ name: 'A' });
	});
});

describe('the page', () => {
	// The shell applies its nav setting to <html> on boot.
	beforeEach(() => void vi.stubGlobal('document', { documentElement: { setAttribute() {} } }));
	afterEach(() => void vi.unstubAllGlobals());

	it('pins, reorders and unpins tools, with toasts, and keeps them across tabs', async () => {
		const app = await buildTestApp({
			plugins: [
				[shellClient, {}],
				[client, options]
			]
		});
		const toasts: string[] = [];
		app.shell!.toasts.subscribe((list) =>
			list.forEach((t) => toasts.includes(t.message) || toasts.push(t.message))
		);
		const shortcuts = app.tools!.shortcuts!;
		expect(shortcuts.togglePin('/utils/c')).toBe(true);
		expect(shortcuts.togglePin('/utils/a')).toBe(true);
		expect(shortcuts.state.pins).toEqual(['/utils/c', '/utils/a']);
		expect(toasts).toEqual(['Pinned to Home.']);
		expect(shortcuts.movePin('/utils/a', -1)).toBe(true);
		expect(shortcuts.state.pins).toEqual(['/utils/a', '/utils/c']);

		const other = await app.openTab();
		expect(other.tools!.shortcuts!.state.pins).toEqual(['/utils/a', '/utils/c']);
		other.tools!.shortcuts!.togglePin('/utils/a');
		await app.settle();
		expect(shortcuts.state.pins).toEqual(['/utils/c']);
		expect(other.shell!.toasts.list().map((t) => t.message)).toEqual(['Removed from Home.']);
		// Not a tool: nothing happens.
		expect(shortcuts.togglePin('/hello')).toBe(false);
		expect(shortcuts.state.pins).toEqual(['/utils/c']);
	});

	it('turns apps on and off, hides their tools but keeps their pins, and syncs tabs', async () => {
		const app = await buildTestApp({ plugins: [[client, withApps]] });
		const tools = app.tools!;
		const paths = () => tools.list().map((t) => t.path);
		expect(paths()).toEqual(['/utils/a', '/utils/c', '/utils/s']);
		expect(tools.all()).toHaveLength(4);
		expect(tools.shortcuts!.togglePin('/utils/a')).toBe(true);

		let calls = 0;
		const stop = tools.subscribe(() => calls++);
		expect(calls).toBe(1);
		expect(tools.setOn('kitchen', false)).toBe(true);
		expect(calls).toBe(2);
		expect(tools.isOn('kitchen')).toBe(false);
		expect(paths()).toEqual(['/utils/c', '/utils/s']);
		// Hidden, not unpinned.
		expect(tools.shortcuts!.state.pins).toEqual(['/utils/a']);
		expect(JSON.parse(app.sharedStorage.backing.get('app:settings')!).apps).toEqual({
			kitchen: false
		});
		// Nothing to change: no call, no write.
		expect(tools.setOn('kitchen', false)).toBe(true);
		expect(calls).toBe(2);
		expect(tools.setOn('nope', true)).toBe(false);

		const other = await app.openTab();
		expect(other.tools!.isOn('kitchen')).toBe(false);
		other.tools!.setOn('games', true);
		await app.settle();
		expect(calls).toBe(3);
		expect(paths()).toEqual(['/utils/b', '/utils/c', '/utils/s']);
		// Turned back on: choosing the default forgets the choice.
		other.tools!.setOn('kitchen', true);
		await app.settle();
		expect(paths()).toEqual(['/utils/a', '/utils/b', '/utils/c', '/utils/s']);
		expect(JSON.parse(app.sharedStorage.backing.get('app:settings')!).apps).toEqual({
			games: true
		});
		stop();
		other.tools!.setOn('games', false);
		await app.settle();
		expect(calls).toBe(4);
	});

	it('without apps, adds no setting and shows every tool', async () => {
		const app = await buildTestApp({ plugins: [[client, options]] });
		expect(app.settings.fields().some((f) => f.name === 'apps')).toBe(false);
		expect(app.tools!.list()).toHaveLength(items.length);
		expect(app.tools!.apps()).toEqual([]);
	});

	it('records recently used tools on navigation, never private ones', async () => {
		const app = await buildTestApp({ plugins: [[client, options]] }, { path: '/utils/a' });
		for (const path of ['/hello', '/utils/b', '/utils/private', '/utils/c/', '/utils/d'])
			await app.navigate(path);
		expect(app.tools!.shortcuts!.state.recent).toEqual(['/utils/d', '/utils/c', '/utils/b']);
		const saved = app.sharedStorage.backing.get('app:tools:shortcuts');
		expect(JSON.parse(saved!)).toEqual({ pins: [], recent: ['/utils/d', '/utils/c', '/utils/b'] });
	});

	it('adds and removes tools at runtime, with their pins and recents', async () => {
		const app = await buildTestApp({ plugins: [[client, options]] }, { path: '/hello' });
		const tools = app.tools!;
		let calls = 0;
		tools.subscribe(() => calls++);
		tools.add(tool('water', { path: '/utils/a#water', name: 'Water' }));
		expect(calls).toBe(2);
		expect(tools.list().map((t) => t.path)).toContain('/utils/a#water');

		// The fragment tells the tool apart from its page; any other fragment is the page.
		await app.navigate('/utils/a#water');
		await app.navigate('/utils/a#other');
		expect(tools.shortcuts!.state.recent).toEqual(['/utils/a', '/utils/a#water']);
		expect(tools.shortcuts!.togglePin('/utils/a#water')).toBe(true);

		// Saved while the tool isn't there yet (another tab, before it's added): kept.
		const other = await app.openTab();
		expect(other.tools!.shortcuts!.state).toEqual({
			pins: ['/utils/a#water'],
			recent: ['/utils/a', '/utils/a#water']
		});

		// Renamed in place: same spot, same pin.
		expect(tools.update(tool('water', { path: '/utils/a#water', name: 'Water intake' }))).toBe(
			true
		);
		expect(calls).toBe(3);
		expect(tools.get('/utils/a#water')?.name).toBe('Water intake');
		expect(tools.shortcuts!.state.pins).toEqual(['/utils/a#water']);
		expect(tools.update(tool('none', { path: '/utils/a#none' }))).toBe(false);

		expect(tools.remove('/utils/a#water')).toBe(true);
		expect(calls).toBe(4);
		expect(tools.remove('/utils/a#water')).toBe(false);
		expect(tools.shortcuts!.state).toEqual({ pins: [], recent: ['/utils/a'] });
		expect(JSON.parse(app.sharedStorage.backing.get('app:tools:shortcuts')!)).toEqual({
			pins: [],
			recent: ['/utils/a']
		});
		expect(() => tools.add(tool('bad', { path: '/utils/a#no good' }))).toThrow();
	});

	it('only writes when something changes', async () => {
		const storage = memoryStorage();
		const set = vi.spyOn(storage, 'set');
		const app = await buildTestApp({ plugins: [[client, options]] }, { storage });
		await app.navigate('/hello');
		expect(set).not.toHaveBeenCalled();
		await app.navigate('/utils/a');
		await app.navigate('/utils/a');
		expect(set).toHaveBeenCalledOnce();
	});

	it('ignores saved tools that no longer exist', async () => {
		const storage = memoryStorage({
			'app:tools:shortcuts': JSON.stringify({
				pins: ['/utils/retired', '/utils/a'],
				recent: ['/utils/retired', '/utils/b', '/utils/private']
			})
		});
		const app = await buildTestApp({ plugins: [[client, options]] }, { storage });
		expect(app.tools!.shortcuts!.state).toEqual({ pins: ['/utils/a'], recent: ['/utils/b'] });
	});

	it('keeps the key an app already uses', async () => {
		const storage = memoryStorage({
			'app:home:shortcuts': JSON.stringify({ pins: ['/utils/a'], recent: [] })
		});
		const app = await buildTestApp(
			{ plugins: [[client, { ...options, storageKey: 'app:home:shortcuts' }]] },
			{ storage }
		);
		expect(app.tools!.shortcuts!.state.pins).toEqual(['/utils/a']);
		await app.navigate('/utils/b');
		expect(JSON.parse(storage.get('app:home:shortcuts')!).recent).toEqual(['/utils/b']);
		expect(storage.get('app:tools:shortcuts')).toBeNull();
	});

	it('warns about a tool with no route (added from the page entry only)', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await buildTestApp(
			{
				plugins: [
					toolsFactory(options),
					definePlugin((a) => a.tools!.add(tool('stray')), { name: 'stray' })
				]
			},
			{ import: importer }
		);
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0]!.join(' ')).toMatch(/"\/utils\/stray" has no route/);
		warn.mockRestore();
	});

	it("with storage blocked, reports a pin that couldn't be saved but not a visit", async () => {
		const blocked: StorageAdapter = {
			get: () => {
				throw new DOMException('blocked', 'SecurityError');
			},
			set: () => {
				throw new DOMException('blocked', 'SecurityError');
			},
			remove: () => {},
			keys: () => []
		};
		const app = await buildTestApp(
			{
				plugins: [
					[shellClient, {}],
					[client, options]
				]
			},
			{ storage: blocked }
		);
		const messages = () => app.shell!.toasts.list().map((t) => t.message);
		await app.navigate('/utils/a');
		expect(messages()).toEqual([]);
		// Still listed in this tab.
		expect(app.tools!.shortcuts!.state.recent).toEqual(['/utils/a']);
		expect(app.tools!.shortcuts!.togglePin('/utils/b')).toBe(false);
		expect(messages()).toEqual([expect.stringContaining("Couldn't save")]);
		expect(app.tools!.shortcuts!.state.pins).toEqual(['/utils/b']);
	});

	it('adds its block to Home with the shell, and takes it away on close', async () => {
		const app = await buildTestApp({
			plugins: [
				[shellClient, {}],
				[client, options]
			]
		});
		await vi.waitFor(() => expect(app.shell!.home.list()).toHaveLength(1));
		const home = app.shell!.home;
		await app.close();
		expect(home.list()).toHaveLength(0);
		// Without the shell there is no Home to add to.
		const bare = await buildTestApp({ plugins: [[client, options]] });
		expect(bare.shell).toBeUndefined();
	});
});

describe('in Node', () => {
	it('boots with apps and no document (#178)', async () => {
		expect(typeof document).toBe('undefined');
		const app = await buildTestApp({
			plugins: [[client, { ...options, apps: [{ id: 'x', name: 'X', emoji: '❌', blurb: 'X.' }] }]]
		});
		expect(app.tools!.isOn('x')).toBe(true);
	});
});
