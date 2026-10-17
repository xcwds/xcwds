import { memoryStorage, pluginMeta } from '@xcwds/core';
import toolsFactory from '@xcwds/plugin-tools';
import toolsClient from '@xcwds/plugin-tools/client';
import { buildTestApp, type Importer } from '@xcwds/testing';
import { describe, expect, it } from 'vitest';
import client, { DEFAULT_EMOJI } from './client.js';
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
		// Data for a block the app no longer has isn't shown.
		blocks.save({ ...added.app, blocks: [{ id: 'notes', type: 'notes', label: 'Notes' }] });
		expect(blocks.data(id).blocks).toEqual({});
		expect(blocks.saveData('nope', counted(1))).toBe(false);
		expect(blocks.data('nope')).toEqual({ format: 1, blocks: {} });
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
		expect(blocks.data(id).blocks.glasses).toMatchObject({ value: 5 });

		expect(blocks.save({ ...added.app, private: false }).ok).toBe(true);
		expect(has(app, `app:blocks:private:${id}`)).toBe(false);
		expect(blocks.data(id).blocks.glasses).toMatchObject({ value: 5 });
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
