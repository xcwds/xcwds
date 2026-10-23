import { pluginMeta } from '@xcwds/core';
import { buildTestApp, type Importer } from '@xcwds/testing';
import { describe, expect, it, vi } from 'vitest';
import client, { REFRESH_MINUTES, notionPlugin, type NotionPluginEnv } from './client.js';
import notionFactory, { build } from './index.js';
import { REASON, resolveOptions } from './options.js';
import type { Source } from './sources.js';

const RELAY = 'https://relay.example';
const TOKEN = 'ntn_1234567890abcdef';
const PAGE = '0c940186-ab70-4351-bb34-2d16f0635d49';
const DS = '59833787-2cf9-4fdf-8782-e53db20768a5';

const importer: Importer = async (id) => {
	const entries: Record<string, () => Promise<Record<string, unknown>>> = {
		'@xcwds/plugin-notion': () => import('./index.js'),
		'@xcwds/plugin-notion/client': () => import('./client.js')
	};
	const load = entries[id];
	if (!load) throw Object.assign(new Error(id), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
	return load();
};

/** A relay standing in for Notion, with one page and one database whose newest is that page. */
function relay(extra: (url: URL, init: RequestInit) => Response | undefined = () => undefined) {
	let title = 'Agenda';
	const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
		const url = new URL(String(input));
		const answer = extra(url, init);
		if (answer) return answer;
		const auth = (init.headers as Record<string, string>).Authorization;
		if (auth !== `Bearer ${TOKEN}`) return new Response('{"code":"unauthorized"}', { status: 401 });
		if (url.pathname === '/v1/users/me')
			return Response.json({ object: 'user', id: 'u', name: 'Agenda bot' });
		if (url.pathname.endsWith('/query'))
			return Response.json({ results: [{ id: PAGE }], has_more: false, next_cursor: null });
		if (url.pathname === `/v1/pages/${PAGE}`)
			return Response.json({
				object: 'page',
				id: PAGE,
				created_time: '2026-10-22T06:00:00.000Z',
				properties: { Name: { type: 'title', title: [{ plain_text: title }] } }
			});
		if (url.pathname.endsWith('/children'))
			return Response.json({
				results: [
					{ id: 'b1', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Gym' }] } }
				],
				has_more: false,
				next_cursor: null
			});
		return new Response('{"code":"object_not_found"}', { status: 404 });
	});
	return { fetch, retitle: (next: string) => (title = next) };
}

function setup(env: Partial<NotionPluginEnv> & { fetch: typeof fetch }) {
	let time = Date.UTC(2026, 9, 22, 12);
	const clock = { now: () => time, advance: (ms: number) => (time += ms) };
	const plugin = notionPlugin({ sleep: async () => {}, now: clock.now, ...env });
	return { plugin, clock };
}

const agenda: Source = {
	id: 's1',
	label: 'Agenda',
	kind: 'database',
	dataSource: DS,
	sort: { by: 'created' }
};

describe('options', () => {
	it('needs an https relay origin and a page path, and declares the relay as its network use', async () => {
		expect(resolveOptions({ relay: RELAY })).toEqual({
			relay: RELAY,
			page: '/notion',
			register: false
		});
		expect(resolveOptions({ relay: RELAY, page: '/utils/notion' })).toMatchObject({
			page: '/utils/notion'
		});
		expect(() => resolveOptions({})).toThrow(/`relay` is required/);
		for (const relay of [
			'http://relay.example',
			'https://relay.example/',
			'relay.example',
			'wss://x.example'
		])
			expect(() => resolveOptions({ relay }), relay).toThrow(/`relay` must be an https: origin/);
		expect(() => resolveOptions({ relay: RELAY, page: 'notion' })).toThrow(/`page`/);
		expect(() => resolveOptions({ relay: RELAY, token: 'x' })).toThrow(/unknown option `token`/);
		expect(() => resolveOptions(null)).toThrow(/must be an object/);
		expect(() => resolveOptions({ relay: RELAY, register: 'yes' })).toThrow(/`register`/);
		expect(resolveOptions({ relay: RELAY, register: true })).toMatchObject({ register: true });

		const network = { origins: [RELAY], reason: REASON };
		for (const plugin of [build, client]) {
			const declared = pluginMeta(plugin).network as (o: unknown) => unknown;
			expect(declared({ relay: RELAY })).toEqual(network);
		}
		expect(notionFactory({ relay: RELAY }).name).toBe('@xcwds/plugin-notion');
		await expect(
			buildTestApp(
				{ plugins: [notionFactory({ relay: 'http://x.example' })] },
				{ import: importer }
			)
		).rejects.toThrow(/@xcwds\/plugin-notion/);
	});

	it('loads from a config with its saved entries, out of backups where they should be', async () => {
		const app = await buildTestApp(
			{ plugins: [notionFactory({ relay: RELAY })] },
			{ import: importer }
		);
		expect(app.notion).toMatchObject({ relay: RELAY, page: '/notion' });
		expect(app.notion!.connected()).toBe(false);
		const entries = Object.fromEntries(app.storage.entries().map((e) => [e.key, e]));
		expect(entries['app:notion:token']).toMatchObject({
			group: 'notion-connection',
			backup: false,
			sensitive: true
		});
		expect(entries['app:notion:sources']).toMatchObject({ backup: true });
		expect(entries['app:notion:copies']).toMatchObject({ backup: false, sensitive: true });
		expect(app.settings.get().notionRefreshMinutes).toBe(REFRESH_MINUTES);
		await app.close();
	});

	it('registers the private view page, and the sources page only with `register`', async () => {
		const app = await buildTestApp(
			{ plugins: [notionFactory({ relay: RELAY, page: '/utils/notion' })] },
			{ import: importer }
		);
		expect(app.routes.get('/utils/notion/view')).toMatchObject({
			title: 'Notion page',
			parent: '/utils/notion',
			width: 'wide',
			private: true
		});
		// Listed by the app (as a tool, say), so not registered here.
		expect(app.routes.get('/utils/notion')).toBeUndefined();
		await app.close();

		const registered = await buildTestApp(
			{ plugins: [notionFactory({ relay: RELAY, register: true })] },
			{ import: importer }
		);
		expect(registered.routes.get('/notion')).toMatchObject({
			title: 'Notion',
			width: 'wide',
			private: true
		});
		expect(registered.routes.get('/notion/view')).toMatchObject({ parent: '/notion' });
		await registered.close();
	});
});

describe('app.notion', () => {
	it('connects only with a token Notion accepts, and never keeps a rejected one', async () => {
		const { fetch } = relay();
		const app = await buildTestApp({ plugins: [[setup({ fetch }).plugin, { relay: RELAY }]] });
		const notion = app.notion!;
		const refused = await notion.connect('ntn_wrong_token_000');
		expect(refused).toMatchObject({ ok: false, error: 'unauthorized' });
		expect(JSON.stringify(refused)).not.toContain('ntn_wrong');
		expect(notion.connected()).toBe(false);
		expect(await notion.connect('short')).toMatchObject({ ok: false });
		expect(await notion.connect(`  ${TOKEN}\n`)).toEqual({ ok: true, name: 'Agenda bot' });
		expect(notion.connected()).toBe(true);
		expect(String(fetch.mock.calls.at(-1)![0])).toBe(`${RELAY}/v1/users/me`);
		await app.close();
	});

	it('downloads a source, keeps the copy, and refreshes only when stale or asked', async () => {
		const { fetch, retitle } = relay();
		const { plugin, clock } = setup({ fetch });
		const app = await buildTestApp({ plugins: [[plugin, { relay: RELAY }]] });
		const notion = app.notion!;
		const changes = vi.fn();
		notion.onChange(changes);

		expect(notion.saveSources(() => [agenda])).toBe(true);
		expect(await notion.refresh('s1')).toMatchObject({ error: 'not-connected' });
		await notion.connect(TOKEN);
		expect(notion.stale('s1')).toBe(true);
		expect(await notion.refresh('s1')).toEqual({ downloading: false });
		expect(notion.copy('s1')).toMatchObject({ id: PAGE, title: 'Agenda', fetchedAt: clock.now() });
		expect(changes).toHaveBeenCalled();

		// Fresh: not downloaded again until the setting's minutes pass, unless forced.
		retitle('Agenda, later');
		const calls = fetch.mock.calls.length;
		await notion.refresh('s1');
		expect(fetch.mock.calls.length).toBe(calls);
		clock.advance(REFRESH_MINUTES * 60_000);
		expect(notion.stale('s1')).toBe(true);
		await notion.refresh('s1');
		expect(notion.copy('s1')?.title).toBe('Agenda, later');
		retitle('Forced');
		await notion.refresh('s1', { force: true });
		expect(notion.copy('s1')?.title).toBe('Forced');

		// 0 minutes: only by hand.
		app.settings.set({ notionRefreshMinutes: 0 });
		clock.advance(24 * 60 * 60_000);
		expect(notion.stale('s1')).toBe(false);
		await app.close();
	});

	it('keeps the saved copy when a refresh fails, and says why', async () => {
		let down = false;
		const { fetch } = relay(() => (down ? new Response('{}', { status: 500 }) : undefined));
		const app = await buildTestApp({ plugins: [[setup({ fetch }).plugin, { relay: RELAY }]] });
		const notion = app.notion!;
		notion.saveSources(() => [agenda]);
		await notion.connect(TOKEN);
		await notion.refresh('s1');
		down = true;
		const status = await notion.refresh('s1', { force: true });
		expect(status).toMatchObject({ downloading: false, error: 'failed' });
		expect(status.message).toMatch(/Try again/);
		expect(notion.status('s1')).toEqual(status);
		expect(notion.copy('s1')?.title).toBe('Agenda');
		await app.close();
	});

	it('runs one download per source at a time, and holds updates back meanwhile', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const { fetch } = relay();
		const slow = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			if (String(input).endsWith('/children')) await gate;
			return fetch(input, init);
		});
		const app = await buildTestApp({
			plugins: [[setup({ fetch: slow as typeof globalThis.fetch }).plugin, { relay: RELAY }]]
		});
		const notion = app.notion!;
		notion.saveSources(() => [agenda]);
		await notion.connect(TOKEN);
		const first = notion.refresh('s1');
		const second = notion.refresh('s1', { force: true });
		expect(second).toBe(first);
		await vi.waitFor(() => expect(notion.status('s1').downloading).toBe(true));
		expect(await app.hooks.collect('onBeforeReload', [])).toEqual(['Notion download']);
		release();
		await first;
		expect(await app.hooks.collect('onBeforeReload', [])).toEqual([]);
		await app.close();
	});

	it('refreshes stale sources when the app comes back, and cancels downloads when it goes', async () => {
		const { fetch } = relay();
		const { plugin, clock } = setup({ fetch });
		const app = await buildTestApp({ plugins: [[plugin, { relay: RELAY }]] });
		const notion = app.notion!;
		notion.saveSources(() => [agenda]);
		await app.hooks.run('onVisible', []);
		expect(fetch).not.toHaveBeenCalled(); // not connected
		await notion.connect(TOKEN);
		await app.hooks.run('onVisible', []);
		await vi.waitFor(() => expect(notion.copy('s1')).toBeDefined());

		clock.advance(REFRESH_MINUTES * 60_000);
		const hanging = vi.fn(
			(_input: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) =>
					init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
				)
		);
		fetch.mockImplementation(hanging);
		await app.hooks.run('onVisible', []);
		await vi.waitFor(() => expect(notion.status('s1').downloading).toBe(true));
		await app.hooks.run('onHidden', []);
		await vi.waitFor(() => expect(notion.status('s1')).toMatchObject({ error: 'aborted' }));
		expect(notion.copy('s1')).toBeDefined();
		await app.close();
	});

	it('disconnecting removes the token and copies, and drops a download from before', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const { fetch } = relay();
		let hold = false;
		const gated = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			if (hold && String(input).endsWith('/query')) await gate;
			return fetch(input, init);
		});
		const app = await buildTestApp({
			plugins: [[setup({ fetch: gated as typeof globalThis.fetch }).plugin, { relay: RELAY }]]
		});
		const notion = app.notion!;
		notion.saveSources(() => [agenda]);
		await notion.connect(TOKEN);
		await notion.refresh('s1');
		hold = true;
		const pending = notion.refresh('s1', { force: true });
		notion.disconnect();
		release();
		await pending;
		expect(notion.connected()).toBe(false);
		expect(notion.copy('s1')).toBeUndefined();
		expect(
			app.storage.read(app.storage.entries().find((e) => e.key === 'app:notion:copies')!)
		).toBeUndefined();
		expect(notion.sources()).toEqual([agenda]);
		// The aborted download leaves no error behind for the next connection.
		expect(notion.status('s1')).toEqual({ downloading: false });
		await app.close();
	});

	it('connecting again throws away a download started with the old token', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const { fetch, retitle } = relay();
		let hold = false;
		const gated = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			if (hold && String(input).endsWith('/query')) await gate;
			return fetch(input, init);
		});
		const app = await buildTestApp({
			plugins: [[setup({ fetch: gated as typeof globalThis.fetch }).plugin, { relay: RELAY }]]
		});
		const notion = app.notion!;
		notion.saveSources(() => [agenda]);
		await notion.connect(TOKEN);
		await notion.refresh('s1');
		retitle('From the old connection');
		hold = true;
		const pending = notion.refresh('s1', { force: true });
		await vi.waitFor(() => expect(notion.status('s1').downloading).toBe(true));
		expect(await notion.connect(TOKEN)).toMatchObject({ ok: true });
		release();
		await pending;
		expect(notion.copy('s1')?.title).toBe('Agenda');
		await app.close();
	});

	it('removing a source removes its copy; backups carry the sources only', async () => {
		const { fetch } = relay();
		const app = await buildTestApp({ plugins: [[setup({ fetch }).plugin, { relay: RELAY }]] });
		const notion = app.notion!;
		const page: Source = { id: 's2', label: 'Page', kind: 'page', page: PAGE };
		notion.saveSources(() => [agenda, page]);
		await notion.connect(TOKEN);
		await notion.refresh('s1');
		await notion.refresh('s2');

		const backup = JSON.stringify(app.storage.exportData());
		expect(backup).toContain('app:notion:sources');
		expect(backup).not.toContain(TOKEN);
		expect(backup).not.toContain('app:notion:copies');

		// A bad source is refused, and the saved list stays readable.
		const bad = { ...page, id: 's3', page: 'not-an-id' } as Source;
		expect(notion.saveSources((list) => [...list, bad])).toBe(false);
		expect(notion.sources().map((s) => s.id)).toEqual(['s1', 's2']);

		notion.saveSources((list) => list.filter((s) => s.id !== 's1'));
		expect(notion.copy('s1')).toBeUndefined();
		expect(notion.copy('s2')).toBeDefined();
		await app.close();
	});
});
