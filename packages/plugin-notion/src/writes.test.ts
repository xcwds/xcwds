import { pluginMeta } from '@xcwds/core';
import { buildTestApp } from '@xcwds/testing';
import { describe, expect, it, vi } from 'vitest';
import { SEND_LOCK, notionPlugin, type LocksLike, type NotionPluginEnv } from './client.js';
import { build } from './index.js';
import { REASON, REASON_WRITES, resolveOptions } from './options.js';
import type { Source } from './sources.js';

const RELAY = 'https://relay.example';
const TOKEN = 'ntn_1234567890abcdef';
const PAGE = '0c940186-ab70-4351-bb34-2d16f0635d49';
const TODO = '7a1b2c3d-0000-4000-8000-000000000001';
const START = Date.UTC(2026, 9, 22, 12);

const page: Source = { id: 's1', label: 'Agenda', kind: 'page', page: PAGE };

/**
 * Notion as the relay passes it on: one page holding a to-do and the notes added to it. `down`
 * makes every request fail as if offline, `refuse` answers writes with that status.
 */
function notion() {
	const state = {
		checked: false,
		edited: START - 60 * 60_000,
		notes: [] as string[],
		down: false,
		refuse: 0,
		/** The writes Notion took (or refused), as their bodies. */
		writes: [] as unknown[]
	};
	const iso = (ms: number) => new Date(ms).toISOString();
	const todo = () => ({
		id: TODO,
		type: 'to_do',
		last_edited_time: iso(state.edited),
		to_do: { checked: state.checked, rich_text: [{ plain_text: 'Gym' }] }
	});
	const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
		if (state.down) throw new TypeError('Failed to fetch');
		const url = new URL(String(input));
		const method = init.method ?? 'GET';
		const auth = (init.headers as Record<string, string>).Authorization;
		if (auth !== `Bearer ${TOKEN}`) return new Response('{"code":"unauthorized"}', { status: 401 });
		if (url.pathname === '/v1/users/me') return Response.json({ object: 'user', name: 'Bot' });
		if (method === 'PATCH') state.writes.push(JSON.parse(String(init.body)));
		if (method === 'PATCH' && state.refuse)
			return Response.json({ code: 'restricted_resource' }, { status: state.refuse });
		if (url.pathname === `/v1/pages/${PAGE}`)
			return Response.json({
				object: 'page',
				id: PAGE,
				created_time: '2026-10-22T06:00:00.000Z',
				properties: { Name: { type: 'title', title: [{ plain_text: 'Agenda' }] } }
			});
		if (url.pathname === `/v1/blocks/${TODO}`) {
			if (method === 'PATCH') {
				const body = JSON.parse(String(init.body)) as { to_do: { checked: boolean } };
				state.checked = body.to_do.checked;
				state.edited = START + 5 * 60_000;
			}
			return Response.json(todo());
		}
		if (url.pathname === `/v1/blocks/${PAGE}/children`) {
			if (method === 'PATCH') {
				const body = JSON.parse(String(init.body)) as {
					children: { paragraph: { rich_text: { text: { content: string } }[] } }[];
				};
				state.notes.push(...body.children.map((c) => c.paragraph.rich_text[0]!.text.content));
				return Response.json({ results: [], has_more: false, next_cursor: null });
			}
			return Response.json({
				results: [
					todo(),
					...state.notes.map((text, i) => ({
						id: `n${i}`,
						type: 'paragraph',
						paragraph: { rich_text: [{ plain_text: text }] }
					}))
				],
				has_more: false,
				next_cursor: null
			});
		}
		return new Response('{"code":"object_not_found"}', { status: 404 });
	});
	return { state, fetch, writes: () => state.writes };
}

async function setup(env: Partial<NotionPluginEnv> = {}, options: Record<string, unknown> = {}) {
	const remote = notion();
	let back: (() => void) | undefined;
	const plugin = notionPlugin({
		fetch: remote.fetch,
		sleep: async () => {},
		now: () => START,
		locks: null,
		online: (listener) => {
			back = listener;
			return () => (back = undefined);
		},
		...env
	});
	const app = await buildTestApp({
		plugins: [[plugin, { relay: RELAY, writes: true, ...options }]]
	});
	const api = app.notion!;
	api.saveSources(() => [page]);
	await api.connect(TOKEN);
	await api.refresh('s1');
	const todo = () => {
		const block = api.copy('s1')!.blocks[0]!;
		return block.type === 'todo' ? block.checked : undefined;
	};
	return { ...remote, app, api, todo, online: () => back?.() };
}

describe('writes option', () => {
	it('is off by default; with it on, the outbox is saved out of backups', async () => {
		expect(resolveOptions({ relay: RELAY })).toMatchObject({ writes: false });
		expect(resolveOptions({ relay: RELAY, writes: true })).toMatchObject({ writes: true });
		expect(() => resolveOptions({ relay: RELAY, writes: 'yes' })).toThrow(/`writes`/);
		// Settings → Privacy says what goes to Notion.
		for (const plugin of [build, notionPlugin()]) {
			const declared = pluginMeta(plugin).network as (o: unknown) => { reason: string };
			expect(declared({ relay: RELAY }).reason).toBe(REASON);
			expect(declared({ relay: RELAY, writes: true }).reason).toBe(REASON_WRITES);
		}

		const { app, api } = await setup();
		expect(api.writes).toBe(true);
		const entry = app.storage.entries().find((e) => e.key === 'app:notion:outbox');
		expect(entry).toMatchObject({ backup: false, sensitive: true });
		await app.close();

		const off = await setup({}, { writes: false });
		expect(off.api.writes).toBe(false);
		expect(off.app.storage.entries().some((e) => e.key === 'app:notion:outbox')).toBe(false);
		expect(off.api.change('s1', { kind: 'check', block: TODO, checked: true })).toBe(false);
		expect(off.writes()).toEqual([]);
		await off.app.close();
	});
});

describe('app.notion changes', () => {
	it('ticks a to-do: shown at once, sent to Notion, and the copy downloaded again', async () => {
		const { api, app, state, writes, todo } = await setup();
		expect(todo()).toBe(false);
		expect(api.change('s1', { kind: 'check', block: TODO, checked: true })).toBe(true);
		// Shown before it's sent.
		expect(todo()).toBe(true);
		expect(api.sending()).toBe(true);
		expect(await api.send()).toEqual({ sent: 1, conflicts: 0, failed: 0, waiting: 0 });
		expect(state.checked).toBe(true);
		expect(writes()).toHaveLength(1);
		expect(writes()).toEqual([{ to_do: { checked: true } }]);
		expect(api.outbox()).toEqual([]);
		// The new copy has it from Notion.
		expect(todo()).toBe(true);
		expect(api.sending()).toBe(false);
		await app.close();
	});

	it('adds a note at the end of the page', async () => {
		const { api, app, state } = await setup();
		expect(api.change('s1', { kind: 'note', text: '  ' })).toBe(false);
		expect(api.change('s1', { kind: 'note', text: 'Bring shoes\nAnd water' })).toBe(true);
		const shown = api.copy('s1')!.blocks.slice(1);
		expect(shown).toEqual([
			{ type: 'paragraph', text: [{ text: 'Bring shoes' }] },
			{ type: 'paragraph', text: [{ text: 'And water' }] }
		]);
		expect(await api.send()).toMatchObject({ sent: 1, waiting: 0 });
		expect(state.notes).toEqual(['Bring shoes', 'And water']);
		expect(api.copy('s1')!.blocks).toHaveLength(3);
		await app.close();
	});

	it('refuses a change it can’t queue', async () => {
		const { api, app, writes } = await setup();
		expect(api.change('s1', { kind: 'check', block: 'not-on-the-page', checked: true })).toBe(
			false
		);
		expect(api.change('nope', { kind: 'check', block: TODO, checked: true })).toBe(false);
		expect(api.change('s1', { kind: 'note', text: Array(21).fill('x').join('\n') })).toBe(false);
		expect(api.outbox()).toEqual([]);
		expect(writes()).toEqual([]);
		await app.close();
	});

	it('keeps changes made offline and sends them once when the connection comes back', async () => {
		const { api, app, state, writes, todo, online } = await setup();
		state.down = true;
		api.change('s1', { kind: 'check', block: TODO, checked: true });
		expect(await api.send()).toMatchObject({ sent: 0, waiting: 1, error: 'offline' });
		expect(api.outbox()).toHaveLength(1);
		expect(todo()).toBe(true);
		// Nothing to wait for: updates go ahead while it can't be sent.
		expect(await app.hooks.collect('onBeforeReload', [])).toEqual([]);

		state.down = false;
		online();
		await vi.waitFor(() => expect(api.outbox()).toEqual([]));
		await vi.waitFor(() => expect(api.sending()).toBe(false));
		expect(state.checked).toBe(true);
		expect(writes()).toHaveLength(1);
		online();
		expect(api.sending()).toBe(false);
		expect(writes()).toHaveLength(1);
		await app.close();
	});

	it('sends a source’s changes before downloading it again, and when the app comes back', async () => {
		const { api, app, state, writes } = await setup();
		state.down = true;
		api.change('s1', { kind: 'note', text: 'One' });
		await api.send();
		state.down = false;
		await api.refresh('s1', { force: true });
		expect(state.notes).toEqual(['One']);
		expect(api.copy('s1')!.blocks).toHaveLength(2);

		state.down = true;
		api.change('s1', { kind: 'note', text: 'Two' });
		await api.send();
		state.down = false;
		await app.hooks.run('onVisible', []);
		await vi.waitFor(() => expect(state.notes).toEqual(['One', 'Two']));
		expect(writes()).toHaveLength(2);
		await app.close();
	});

	it('keeps Notion’s tick when it was edited there since, and says so', async () => {
		const { api, app, state, writes, todo } = await setup();
		state.down = true;
		api.change('s1', { kind: 'check', block: TODO, checked: true });
		await api.send();
		// Ticked and unticked again in Notion meanwhile: it's unticked there, edited later.
		state.edited = START + 10 * 60_000;
		state.down = false;
		expect(await api.send()).toMatchObject({ sent: 0, conflicts: 1, waiting: 0 });
		expect(writes()).toEqual([]);
		expect(api.conflicts()).toEqual([
			{ item: expect.objectContaining({ block: TODO, checked: true }), checked: false }
		]);
		// The copy shows Notion's again.
		expect(todo()).toBe(false);
		api.clearConflicts();
		expect(api.conflicts()).toEqual([]);
		await app.close();
	});

	it('keeps a change Notion refuses until it’s tried again or dropped', async () => {
		const { api, app, state, writes } = await setup();
		state.refuse = 403;
		api.change('s1', { kind: 'note', text: 'Nope' });
		expect(await api.send()).toMatchObject({ sent: 0, failed: 1, waiting: 0 });
		const [item] = api.outbox();
		expect(item).toMatchObject({ failed: { kind: 'not-shared', status: 403 } });
		// A refused change isn't tried again by itself.
		await api.send();
		expect(writes()).toHaveLength(1);

		state.refuse = 0;
		expect(api.retry(item!.id)).toBe(true);
		await vi.waitFor(() => expect(state.notes).toEqual(['Nope']));
		await vi.waitFor(() => expect(api.sending()).toBe(false));

		state.refuse = 403;
		api.change('s1', { kind: 'note', text: 'Drop me' });
		await api.send();
		expect(api.discard(api.outbox()[0]!.id)).toBe(true);
		expect(api.outbox()).toEqual([]);
		expect(api.copy('s1')!.blocks.at(-1)).toMatchObject({ text: [{ text: 'Nope' }] });
		await app.close();
	});

	it('sends one at a time, under a Web Lock, and holds updates back meanwhile', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const names: string[] = [];
		const locks: LocksLike = {
			async request(name, callback) {
				names.push(name);
				await gate;
				return callback();
			}
		};
		const { api, app, writes } = await setup({ locks });
		api.change('s1', { kind: 'check', block: TODO, checked: true });
		const first = api.send();
		const second = api.send();
		expect(await app.hooks.collect('onBeforeReload', [])).toEqual(['Notion changes']);
		release();
		expect(await second).toEqual(await first);
		expect(names).toEqual([SEND_LOCK]);
		expect(writes()).toHaveLength(1);
		expect(await app.hooks.collect('onBeforeReload', [])).toEqual([]);
		await app.close();
	});

	it('sends a change made while a send was finishing', async () => {
		const { api, app, state, fetch } = await setup();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const real = fetch.getMockImplementation()!;
		// Holds the download a send starts afterwards, when the send is past its last change.
		fetch.mockImplementation(async (input, init) => {
			if (String(input).includes(`/v1/pages/${PAGE}`)) await gate;
			return real(input, init);
		});
		api.change('s1', { kind: 'note', text: 'First' });
		await vi.waitFor(() => expect(state.notes).toEqual(['First']));
		api.change('s1', { kind: 'note', text: 'Second' });
		release();
		await vi.waitFor(() => expect(state.notes).toEqual(['First', 'Second']));
		await vi.waitFor(() => expect(api.sending()).toBe(false));
		expect(api.outbox()).toEqual([]);
		await app.close();
	});

	it('shows a sent change from a download started after it, not one already running', async () => {
		const { api, app, state, fetch, todo } = await setup();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const real = fetch.getMockImplementation()!;
		let hold = true;
		let held = false;
		fetch.mockImplementation(async (input, init) => {
			// Notion answers with the page as it is now, and the answer arrives later.
			const answer = real(input, init);
			const read = !init?.method || init.method === 'GET';
			if (hold && read && String(input).includes(`/v1/blocks/${PAGE}/children`)) {
				held = true;
				await gate;
			}
			return answer;
		});
		// A download has read the page before the tick, and is still running when it's sent.
		const before = api.refresh('s1', { force: true });
		await vi.waitFor(() => expect(held).toBe(true));
		api.change('s1', { kind: 'check', block: TODO, checked: true });
		await vi.waitFor(() => expect(state.checked).toBe(true));
		hold = false;
		release();
		await before;
		await vi.waitFor(() => expect(api.sending()).toBe(false));
		expect(api.outbox()).toEqual([]);
		expect(todo()).toBe(true);
		await app.close();
	});

	it('without writes, sending has nothing to do', async () => {
		const { api, app } = await setup({}, { writes: false });
		expect(await api.send()).toEqual({ sent: 0, conflicts: 0, failed: 0, waiting: 0 });
		await app.close();
	});

	it('disconnecting clears the outbox; backups never carry it', async () => {
		const { api, app, state } = await setup();
		state.down = true;
		api.change('s1', { kind: 'note', text: 'Private' });
		await api.send();
		expect(JSON.stringify(app.storage.exportData())).not.toContain('app:notion:outbox');
		api.disconnect();
		expect(api.outbox()).toEqual([]);
		state.down = false;
		expect(await api.send()).toMatchObject({ error: 'not-connected', waiting: 0 });
		expect(state.notes).toEqual([]);
		await app.close();
	});
});
