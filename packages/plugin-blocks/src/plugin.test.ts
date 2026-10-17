import { memoryStorage, pluginMeta } from '@xcwds/core';
import toolsFactory from '@xcwds/plugin-tools';
import toolsClient from '@xcwds/plugin-tools/client';
import { buildTestApp, type Importer } from '@xcwds/testing';
import { describe, expect, it } from 'vitest';
import client, { DEFAULT_EMOJI, NEAR_LIMIT } from './client.js';
import type { AppData } from './data.js';
import type { AppDefinition } from './format.js';
import blocksFactory, { build } from './index.js';
import { resolveOptions } from './options.js';
import { chores, mood, templates, water } from './templates.js';

const importer: Importer = async (id) => {
	const entries: Record<string, () => Promise<Record<string, unknown>>> = {
		'@xcwds/plugin-blocks': () => import('./index.js'),
		'@xcwds/plugin-blocks/client': () => import('./client.js'),
		'@xcwds/plugin-tools': () => import('@xcwds/plugin-tools'),
		'@xcwds/plugin-tools/client': () => import('@xcwds/plugin-tools/client')
	};
	const load = entries[id];
	if (!load) throw Object.assign(new Error(id), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
	return load();
};

const tools = {
	path: '/utils',
	title: 'Utils',
	items: [],
	apps: [{ id: 'yours', name: 'Your apps', emoji: '🧩', blurb: 'Apps you made.' }]
};

/** An app with tools (Your apps joins the `yours` catalog app) and the blocks plugin. */
const withTools = (storage = memoryStorage()) =>
	buildTestApp(
		{
			plugins: [
				[toolsClient, tools],
				[client, { app: 'yours' }]
			]
		},
		{ storage }
	);

/** Whether `key` is saved in the app's (shared) storage. */
const has = (
	app: { sharedStorage: { backing: { get(key: string): string | null | undefined } } },
	key: string
) => app.sharedStorage.backing.get(key) != null;

const counted = (glasses: number): AppData => ({
	format: 1,
	blocks: { glasses: { period: '2026-10-17', value: glasses, history: [] } }
});

describe('options', () => {
	it('fills in defaults and refuses mistakes', () => {
		expect(resolveOptions()).toEqual({ path: '/my-apps', templates });
		expect(resolveOptions({ path: '/apps/mine', templates: [water], app: 'yours' })).toEqual({
			path: '/apps/mine',
			templates: [water],
			app: 'yours'
		});
		expect(() => resolveOptions({ path: 'my-apps' })).toThrow(/`path`/);
		expect(() => resolveOptions({ path: '/my-apps/' })).toThrow(/`path`/);
		expect(() => resolveOptions({ templates: [{ ...water, format: 2 }] })).toThrow(/template 1/);
		expect(() => resolveOptions({ templates: [water, water] })).toThrow(/same `id`/);
		expect(() => resolveOptions({ app: '' })).toThrow(/`app`/);
		expect(() => resolveOptions({ colour: 'red' })).toThrow(/unknown option `colour`/);
	});

	it('fails the build on a bad option, and makes no network requests', async () => {
		await expect(
			buildTestApp({ plugins: [blocksFactory({ path: 'nope' })] }, { import: importer })
		).rejects.toThrow(/@xcwds\/plugin-blocks: `path`/);
		// The catalog app must be one of plugin-tools' apps.
		await expect(
			buildTestApp({ plugins: [blocksFactory({ app: 'yours' })] }, { import: importer })
		).rejects.toThrow(/needs `@xcwds\/plugin-tools`/);
		await expect(
			buildTestApp(
				{ plugins: [toolsFactory(tools), blocksFactory({ app: 'yourz' })] },
				{ import: importer }
			)
		).rejects.toThrow(/"yourz", which isn't in/);
		const withCatalog = await buildTestApp(
			{ plugins: [toolsFactory(tools), blocksFactory({ app: 'yours' })] },
			{ import: importer }
		);
		expect(withCatalog.blocks?.list()).toEqual([]);
		const app = await buildTestApp({ plugins: [blocksFactory()] }, { import: importer });
		expect(app.blocks?.list()).toEqual([]);
		// Its pages: the list, and the two that run an app (the private one locked and never shared).
		expect(withCatalog.routes.get('/my-apps')).toMatchObject({
			title: 'Your apps',
			parent: '/utils'
		});
		expect(app.routes.get('/my-apps')?.parent).toBeUndefined();
		expect(app.routes.get('/my-apps/app')).toMatchObject({ parent: '/my-apps', width: 'narrow' });
		expect(app.routes.get('/my-apps/app')?.private).toBeUndefined();
		expect(app.routes.get('/my-apps/private')).toMatchObject({ parent: '/my-apps', private: true });
		// The builder's two pages, the private one locked too.
		expect(app.routes.get('/my-apps/edit')).toMatchObject({ title: 'New app', parent: '/my-apps' });
		expect(app.routes.get('/my-apps/edit')?.private).toBeUndefined();
		expect(app.routes.get('/my-apps/private-edit')).toMatchObject({
			parent: '/my-apps',
			private: true
		});
		expect(pluginMeta(build).network).toBe(false);
		expect(pluginMeta(client).network).toBe(false);
	});
});

describe('app.blocks', () => {
	it('adds apps from templates as copies, and lists them with their pages', async () => {
		const app = await withTools();
		const blocks = app.blocks!;
		expect(blocks.path).toBe('/my-apps');
		const added = blocks.addFromTemplate(water);
		const secret = blocks.addFromTemplate(mood);
		if (!added.ok || !secret.ok) throw new Error('not saved');
		expect(added.app.id).not.toBe('water');
		expect(blocks.list()).toEqual([
			{
				id: added.app.id,
				name: 'Water',
				emoji: '💧',
				private: false,
				path: `/my-apps/app#${added.app.id}`
			},
			{
				id: secret.app.id,
				name: 'Mood',
				emoji: '🌤️',
				private: true,
				path: `/my-apps/private#${secret.app.id}`
			}
		]);
		// Normal apps are backed up; private ones are personal, in a group of their own.
		const saved = app.sharedStorage.backing;
		expect(JSON.parse(saved.get('app:blocks:apps')!)).toHaveLength(1);
		expect(JSON.parse(saved.get('app:blocks:private-apps')!)).toHaveLength(1);
		const groups = app.storage.groups();
		expect(groups.find((g) => g.id === 'blocks')?.sensitive).toBe(false);
		expect(groups.find((g) => g.id === 'blocks-private')?.sensitive).toBe(true);
	});

	it('keeps data per app, read against its definition', async () => {
		const app = await withTools();
		const blocks = app.blocks!;
		const added = blocks.addFromTemplate(water);
		if (!added.ok) throw new Error('not saved');
		const { id } = added.app;
		expect(blocks.data(id)).toEqual({ format: 1, blocks: {} });
		expect(blocks.saveData(id, counted(3))).toBe(true);
		expect(has(app, `app:blocks:data:${id}`)).toBe(true);
		expect(blocks.data(id).blocks.glasses).toMatchObject({ value: 3 });
		// Data for a block the app no longer has is removed when it's saved, not kept hidden.
		blocks.save({ ...added.app, blocks: [{ id: 'notes', type: 'notes', label: 'Notes' }] });
		expect(blocks.data(id).blocks).toEqual({});
		expect(app.sharedStorage.backing.get(`app:blocks:data:${id}`)).toBe(
			JSON.stringify({ format: 1, blocks: {} })
		);
		expect(blocks.saveData('nope', counted(1))).toBe(false);
		expect(blocks.data('nope')).toEqual({ format: 1, blocks: {} });
	});

	it("keeps an app's data when a save that would drop some of it fails", async () => {
		const storage = memoryStorage();
		const app = await withTools(storage);
		const blocks = app.blocks!;
		const added = blocks.addFromTemplate(water);
		if (!added.ok) throw new Error('not saved');
		const { id } = added.app;
		blocks.saveData(id, counted(4));
		const set = storage.set.bind(storage);
		storage.set = (key, value) => {
			if (key === 'app:blocks:apps') throw new Error('QuotaExceededError');
			set(key, value);
		};
		app.storage.onSaveFailure(() => {});
		const result = blocks.save({ ...added.app, blocks: [] });
		expect(result).toEqual({ ok: false, error: expect.stringMatching(/Couldn't save/) });
		expect(blocks.get(id)?.blocks).toHaveLength(1);
		expect(blocks.data(id).blocks.glasses).toMatchObject({ value: 4 });
	});

	it('refuses an invalid app with a sentence, and saves nothing', async () => {
		const app = await withTools();
		const result = app.blocks!.save({ ...water, name: '' });
		expect(result).toEqual({ ok: false, error: expect.any(String) });
		expect(app.blocks!.list()).toEqual([]);
	});

	it('moves an app and its data when it turns private, and back', async () => {
		const app = await withTools();
		const blocks = app.blocks!;
		const added = blocks.addFromTemplate(water);
		if (!added.ok) throw new Error('not saved');
		const { id } = added.app;
		blocks.saveData(id, counted(5));

		expect(blocks.save({ ...added.app, private: true }).ok).toBe(true);
		expect(has(app, `app:blocks:data:${id}`)).toBe(false);
		expect(has(app, `app:blocks:private:${id}`)).toBe(true);
		expect(has(app, 'app:blocks:apps')).toBe(false);
		expect(blocks.list()).toMatchObject([{ id, private: true, path: `/my-apps/private#${id}` }]);
		expect(blocks.editPathOf(blocks.get(id))).toBe(`/my-apps/private-edit#${id}`);
		expect(blocks.editPathOf()).toBe('/my-apps/edit');
		expect(blocks.data(id).blocks.glasses).toMatchObject({ value: 5 });

		expect(blocks.save({ ...added.app, private: false }).ok).toBe(true);
		expect(has(app, `app:blocks:private:${id}`)).toBe(false);
		expect(blocks.data(id).blocks.glasses).toMatchObject({ value: 5 });

		// Moving and dropping a block at once: only what the new definition keeps moves.
		const notes = { id: 'notes', type: 'notes', label: 'Notes' } as const;
		expect(blocks.save({ ...added.app, private: true, blocks: [notes] }).ok).toBe(true);
		expect(app.sharedStorage.backing.get(`app:blocks:private:${id}`)).toBe(
			JSON.stringify({ format: 1, blocks: {} })
		);
	});

	it("leaves an app where it was when the move can't be saved", async () => {
		const storage = memoryStorage();
		const app = await withTools(storage);
		const blocks = app.blocks!;
		const added = blocks.addFromTemplate(water);
		if (!added.ok) throw new Error('not saved');
		const { id } = added.app;
		blocks.saveData(id, counted(2));
		// Storage is full: nothing more fits.
		const set = storage.set.bind(storage);
		storage.set = (key, value) => {
			if (key.startsWith('app:blocks:private')) throw new Error('QuotaExceededError');
			set(key, value);
		};
		const failures: string[] = [];
		app.storage.onSaveFailure((entry) => failures.push(entry.key));
		const result = blocks.save({ ...added.app, private: true });
		expect(result).toEqual({ ok: false, error: expect.stringMatching(/Couldn't save/) });
		expect(failures).toEqual([`app:blocks:private:${id}`]);
		expect(blocks.list()).toMatchObject([{ id, private: false }]);
		expect(blocks.data(id).blocks.glasses).toMatchObject({ value: 2 });
		expect([...app.sharedStorage.backing.keys()].filter((k) => k.includes('private'))).toEqual([]);
	});

	it('removes an app with its data, and Undo puts both back in their place', async () => {
		const app = await withTools();
		const blocks = app.blocks!;
		const ids = [water, chores].map((t) => {
			const added = blocks.addFromTemplate(t);
			if (!added.ok) throw new Error('not saved');
			return added.app.id;
		});
		blocks.saveData(ids[0]!, counted(4));
		const removed = blocks.remove(ids[0]!);
		expect(removed.ok).toBe(true);
		expect(blocks.list().map((a) => a.id)).toEqual([ids[1]]);
		expect(has(app, `app:blocks:data:${ids[0]}`)).toBe(false);

		expect(removed.restore()).toBe(true);
		expect(blocks.list().map((a) => a.id)).toEqual(ids);
		expect(blocks.data(ids[0]!).blocks.glasses).toMatchObject({ value: 4 });
		// Twice is harmless.
		expect(removed.restore()).toBe(true);
		expect(blocks.list()).toHaveLength(2);
		expect(blocks.remove('nope').ok).toBe(false);
	});

	it('counts what your apps take up, and says when it nears the limit', async () => {
		const app = await withTools();
		const blocks = app.blocks!;
		expect(blocks.usage()).toEqual({ total: 0, apps: {}, nearLimit: false });
		const a = blocks.addFromTemplate(water);
		const b = blocks.addFromTemplate(mood);
		if (!a.ok || !b.ok) throw new Error('not saved');
		blocks.saveData(a.app.id, counted(3));
		const raw = app.sharedStorage.backing;
		const keys = [...raw.keys()].filter((k) => k.startsWith('app:blocks:'));
		const stored = keys.reduce((n, k) => n + k.length + raw.get(k)!.length, 0);
		const usage = blocks.usage();
		// What's saved, as storage counts it.
		expect(usage.total).toBe(stored);
		expect(Object.keys(usage.apps)).toEqual([a.app.id, b.app.id]);
		// Each app counts its own definition and data; the lists add their brackets and commas.
		const apps = Object.values(usage.apps).reduce((n, v) => n + v, 0);
		expect(apps).toBeGreaterThan(0);
		expect(apps).toBeLessThan(usage.total);
		expect(usage.nearLimit).toBe(false);

		// Saved data near the limit (written straight to storage: notes alone can't get there).
		const big: AppData = { format: 1, blocks: { notes: { text: 'x'.repeat(NEAR_LIMIT) } } };
		raw.set(`app:blocks:private:${b.app.id}`, JSON.stringify(big));
		expect(blocks.usage().nearLimit).toBe(true);
	});

	it('keeps the valid apps when one saved definition is broken', async () => {
		const storage = memoryStorage({
			'app:blocks:apps': JSON.stringify([
				{ ...water, id: 'good' },
				{ format: 1, id: 'bad' }
			])
		});
		const app = await withTools(storage);
		expect(app.blocks!.list().map((a) => a.id)).toEqual(['good']);
	});
});

describe('your apps as tools', () => {
	const pathsOf = (app: Awaited<ReturnType<typeof withTools>>) =>
		app.tools!.all().map((t) => [t.path, t.name, t.emoji, t.private ?? false, t.app]);

	it('adds each app as a tool in the catalog app, and follows renames, moves and removals', async () => {
		const storage = memoryStorage({
			'app:blocks:apps': JSON.stringify([{ ...water, id: 'w1' }])
		});
		const app = await withTools(storage);
		const blocks = app.blocks!;
		expect(pathsOf(app)).toEqual([['/my-apps/app#w1', 'Water', '💧', false, 'yours']]);

		// A pin survives a rename.
		expect(app.tools!.shortcuts!.togglePin('/my-apps/app#w1')).toBe(true);
		const w1 = blocks.get('w1') as AppDefinition;
		blocks.save({ ...w1, name: 'Drinks', emoji: undefined });
		expect(pathsOf(app)).toEqual([['/my-apps/app#w1', 'Drinks', DEFAULT_EMOJI, false, 'yours']]);
		expect(app.tools!.shortcuts!.state.pins).toEqual(['/my-apps/app#w1']);

		// Private: a new page, and a private tool (never under Recently used).
		blocks.save({ ...w1, private: true });
		expect(pathsOf(app)).toEqual([['/my-apps/private#w1', 'Water', '💧', true, 'yours']]);

		blocks.remove('w1');
		expect(pathsOf(app)).toEqual([]);
	});

	it('follows apps another tab adds', async () => {
		const app = await withTools();
		const other = await app.openTab();
		other.blocks!.addFromTemplate(chores);
		await expect.poll(() => app.tools!.all().map((t) => t.name)).toEqual(['Chores']);
	});

	it('works without plugin-tools', async () => {
		const app = await buildTestApp({ plugins: [[client, {}]] });
		expect(app.blocks!.addFromTemplate(water).ok).toBe(true);
		expect(app.blocks!.list()).toHaveLength(1);
	});
});
