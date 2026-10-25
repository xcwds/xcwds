import { describe, expect, it, vi } from 'vitest';
import {
	MAX_BLOCKS,
	NOTION_VERSION,
	NotionError,
	createNotionClient,
	parseId,
	type RawBlock
} from './api.js';

const RELAY = 'https://relay.example';
const TOKEN = 'ntn_secret_token_123';
const ID = '0c940186-ab70-4351-bb34-2d16f0635d49';

/** A clock that only moves when the client sleeps, and records each wait. */
function clock() {
	let time = 1_000_000;
	const waits: number[] = [];
	return {
		waits,
		now: () => time,
		sleep: vi.fn(async (ms: number, signal?: AbortSignal) => {
			if (signal?.aborted) throw signal.reason;
			waits.push(ms);
			time += ms;
		})
	};
}

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** A relay standing in for Notion, answering with `handler`. */
function relay(handler: Handler) {
	return vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
		handler(new URL(String(input)), init ?? {})
	);
}

function client(handler: Handler, extra: Partial<Parameters<typeof createNotionClient>[0]> = {}) {
	const time = clock();
	const fetch = relay(handler);
	const notion = createNotionClient({
		relay: RELAY + '/',
		token: TOKEN,
		fetch,
		sleep: time.sleep,
		now: time.now,
		...extra
	});
	return { notion, fetch, time };
}

const list = (results: unknown[], next: string | null = null) =>
	Response.json({ object: 'list', results, has_more: next !== null, next_cursor: next });

const block = (id: string, type = 'paragraph', has_children = false): RawBlock => ({
	id,
	type,
	has_children,
	[type]: { rich_text: [{ plain_text: id }] }
});

describe('parseId', () => {
	it('finds the page id in links and ids, dashed or not', () => {
		const plain = ID.replaceAll('-', '');
		expect(parseId(ID)).toBe(ID);
		expect(parseId(plain.toUpperCase())).toBe(ID);
		expect(parseId(`https://www.notion.so/team/Daily-agenda-${plain}`)).toBe(ID);
		expect(parseId(`https://www.notion.so/${plain}?v=${'1'.repeat(32)}`)).toBe(ID);
		expect(parseId(`https://www.notion.so/Page-${plain}#${'2'.repeat(32)}`)).toBe(ID);
		expect(parseId(`  ${ID}  `)).toBe(ID);
		expect(parseId('https://www.notion.so/no-id-here')).toBeUndefined();
		expect(parseId(plain.slice(1))).toBeUndefined();
		expect(parseId(plain + 'a')).toBeUndefined();
		expect(parseId('')).toBeUndefined();
	});
});

describe('the Notion client', () => {
	it('sends the token and pinned version to the relay, with nothing else of the page', async () => {
		const { notion, fetch } = client((url) =>
			url.pathname.endsWith('/query')
				? list([])
				: Response.json({ object: 'user', id: 'u', name: 'Bot' })
		);
		expect(await notion.me()).toMatchObject({ name: 'Bot' });
		const [url, init] = fetch.mock.calls[0]!;
		expect(String(url)).toBe(`${RELAY}/v1/users/me`);
		expect(init).toMatchObject({
			method: 'GET',
			credentials: 'omit',
			cache: 'no-store',
			referrerPolicy: 'no-referrer'
		});
		expect(init!.headers).toEqual({
			Authorization: `Bearer ${TOKEN}`,
			'Notion-Version': NOTION_VERSION
		});

		await notion.query(ID, { page_size: 1 });
		const [queryUrl, queryInit] = fetch.mock.calls[1]!;
		expect(String(queryUrl)).toBe(`${RELAY}/v1/data_sources/${ID}/query`);
		expect(queryInit).toMatchObject({ method: 'POST', body: '{"page_size":1}' });
		expect(queryInit!.headers).toMatchObject({ 'Content-Type': 'application/json' });
	});

	it('ticks a to-do and adds paragraphs with PATCH (#109)', async () => {
		const { notion, fetch } = client((url, init) =>
			url.pathname.endsWith('/children')
				? list([block('p1')])
				: Response.json({ ...block(ID, 'to_do'), method: init.method })
		);
		expect(await notion.block(ID)).toMatchObject({ id: ID, method: 'GET' });
		expect(await notion.setChecked(ID, true)).toMatchObject({ id: ID, method: 'PATCH' });
		expect((await notion.appendParagraphs(ID, ['Fed', 'Walked'])).results).toHaveLength(1);
		expect(fetch.mock.calls[0]![1]!.body).toBeUndefined();
		const [tick, append] = fetch.mock.calls.slice(1).map(([url, init]) => ({
			url: String(url),
			method: init!.method,
			body: JSON.parse(String(init!.body)),
			headers: init!.headers
		}));
		expect(tick).toMatchObject({
			url: `${RELAY}/v1/blocks/${ID}`,
			method: 'PATCH',
			body: { to_do: { checked: true } },
			headers: { 'Content-Type': 'application/json' }
		});
		expect(append).toMatchObject({ url: `${RELAY}/v1/blocks/${ID}/children`, method: 'PATCH' });
		expect(append!.body).toEqual({
			children: ['Fed', 'Walked'].map((content) => ({
				object: 'block',
				type: 'paragraph',
				paragraph: { rich_text: [{ type: 'text', text: { content } }] }
			}))
		});
	});

	it('keeps requests apart, to stay under Notion’s rate limit', async () => {
		const { notion, time } = client(() => Response.json({ object: 'page', id: ID }));
		await Promise.all([notion.page(ID), notion.page(ID), notion.page(ID)]);
		expect(time.waits).toEqual([350, 350]);
	});

	it('follows pagination', async () => {
		const { notion, fetch } = client((url) => {
			const cursor = url.searchParams.get('start_cursor');
			if (!cursor) return list([block('a'), block('b')], 'c1');
			if (cursor === 'c1') return list([block('c')], 'c2');
			return list([block('d')]);
		});
		expect((await notion.allChildren(ID)).map((b) => b.id)).toEqual(['a', 'b', 'c', 'd']);
		expect(fetch.mock.calls.map(([url]) => new URL(String(url)).search)).toEqual([
			'?page_size=100',
			'?page_size=100&start_cursor=c1',
			'?page_size=100&start_cursor=c2'
		]);
	});

	it('waits out 429 with Retry-After, then backs off, then gives up', async () => {
		let calls = 0;
		const { notion, time } = client(() => {
			calls++;
			if (calls === 1)
				return new Response('{"code":"rate_limited"}', {
					status: 429,
					headers: { 'Retry-After': '3' }
				});
			if (calls === 2) return new Response('{"code":"rate_limited"}', { status: 429 });
			return Response.json({ object: 'page', id: ID });
		});
		expect(await notion.page(ID)).toMatchObject({ id: ID });
		// 3 s as asked, then 2 s of backoff; the 350 ms gaps were already covered by those waits.
		expect(time.waits).toEqual([3000, 2000]);

		const limited = client(() => new Response('{"code":"rate_limited"}', { status: 429 }));
		const error = await limited.notion.page(ID).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NotionError);
		expect(error).toMatchObject({ kind: 'rate-limited', status: 429, code: 'rate_limited' });
		expect(limited.fetch).toHaveBeenCalledTimes(4);

		// A wait longer than a minute isn't worth holding a download for.
		const long = client(
			() => new Response('{}', { status: 429, headers: { 'Retry-After': '120' } })
		);
		await expect(long.notion.page(ID)).rejects.toMatchObject({ kind: 'rate-limited' });
		expect(long.fetch).toHaveBeenCalledOnce();
	});

	it('says why a request failed, never with the token or Notion’s words', async () => {
		const cases: (() => Response | Promise<Response>)[] = [
			() => new Response(`{"code":"unauthorized","message":"${TOKEN}"}`, { status: 401 }),
			() => new Response(`{"code":"object_not_found","message":"${TOKEN}"}`, { status: 404 }),
			() => new Response('{"code":"restricted_resource"}', { status: 403 }),
			() => new Response('{"code":"relay_forbidden"}', { status: 403 }),
			() => new Response('{"code":"relay_upstream"}', { status: 502 }),
			() => new Response('oops', { status: 500 }),
			() => new Response('not json', { status: 200 }),
			() => Promise.reject(new TypeError(`fetch failed ${TOKEN}`))
		];
		const kinds = [];
		for (const handler of cases) {
			const { notion } = client(handler);
			const error = (await notion.page(ID).catch((e: unknown) => e)) as NotionError;
			expect(error).toBeInstanceOf(NotionError);
			expect(error.message).not.toContain(TOKEN);
			expect(String(error.stack)).not.toContain(TOKEN);
			expect(JSON.stringify(error)).not.toContain(TOKEN);
			kinds.push(error.kind);
		}
		expect(kinds).toEqual([
			'unauthorized',
			'not-shared',
			'not-shared',
			'failed',
			'offline',
			'failed',
			'failed',
			'offline'
		]);
	});

	it('refuses a list that isn’t one with a NotionError', async () => {
		for (const body of [{ object: 'error' }, { results: 'nope' }, null]) {
			const { notion } = client(() => Response.json(body));
			await expect(notion.allChildren(ID)).rejects.toMatchObject({ kind: 'failed' });
			await expect(notion.blocks(ID)).rejects.toBeInstanceOf(NotionError);
			await expect(notion.search()).rejects.toMatchObject({ kind: 'failed' });
			await expect(notion.query(ID)).rejects.toMatchObject({ kind: 'failed' });
		}
	});

	it('stops when its signal aborts, waiting or fetching', async () => {
		const controller = new AbortController();
		const { notion, fetch } = client(
			(_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
				}),
			{ signal: controller.signal }
		);
		// The first is fetching, the second waiting its turn.
		const first = notion.page(ID);
		const second = notion.page(ID);
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
		controller.abort();
		await expect(first).rejects.toMatchObject({ kind: 'aborted' });
		await expect(second).rejects.toMatchObject({ kind: 'aborted' });
		await expect(notion.page(ID)).rejects.toMatchObject({ kind: 'aborted' });
		expect(fetch).toHaveBeenCalledOnce();
	});
});

describe('client.blocks', () => {
	/** A page whose blocks are `tree[parent]`. */
	function page(tree: Record<string, RawBlock[]>) {
		return client((url) => {
			const parent = url.pathname.split('/')[3]!;
			return list(tree[parent] ?? []);
		});
	}

	it('fetches nested blocks in order, but not child pages or databases', async () => {
		const { notion, fetch } = page({
			[ID]: [
				block('list', 'bulleted_list_item', true),
				block('sub', 'child_page', true),
				block('db', 'child_database', true),
				block('end')
			],
			list: [block('item', 'bulleted_list_item', true)],
			item: [block('deep')]
		});
		const { blocks, truncated } = await notion.blocks(ID);
		expect(truncated).toBe(false);
		expect(blocks.map((b) => b.id)).toEqual(['list', 'sub', 'db', 'end']);
		expect(blocks[0]!.children![0]!.children!.map((b) => b.id)).toEqual(['deep']);
		expect(blocks[1]!.children).toBeUndefined();
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('stops at the depth cap and says so', async () => {
		const tree: Record<string, RawBlock[]> = {};
		let parent = ID;
		for (let i = 0; i < 8; i++) {
			tree[parent] = [block(`level${i}`, 'toggle', true)];
			parent = `level${i}`;
		}
		const { notion } = page(tree);
		const { blocks, truncated } = await notion.blocks(ID);
		expect(truncated).toBe(true);
		let depth = 0;
		for (let level: RawBlock[] | undefined = blocks; level?.length; level = level[0]!.children)
			depth++;
		expect(depth).toBe(5);
	});

	it('stops at the block cap and says so', async () => {
		let n = 0;
		const { notion, fetch } = client((url) => {
			const cursor = Number(url.searchParams.get('start_cursor') ?? 0);
			const results = Array.from({ length: 100 }, () => block(`b${n++}`));
			return list(results, String(cursor + 1));
		});
		const { blocks, truncated } = await notion.blocks(ID);
		expect(truncated).toBe(true);
		expect(blocks).toHaveLength(MAX_BLOCKS);
		expect(fetch).toHaveBeenCalledTimes(MAX_BLOCKS / 100);

		const small = page({ [ID]: [block('a', 'toggle', true), block('b')], a: [block('c')] });
		const capped = await small.notion.blocks(ID, { maxBlocks: 2 });
		expect(capped.truncated).toBe(true);
		expect(capped.blocks.map((b) => b.id)).toEqual(['a', 'b']);
	});
});

describe('client.file (#108)', () => {
	const LINK =
		'https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/f/cat.png?X-Amz-Signature=s';
	const image = (bytes: number, headers: Record<string, string> = {}) =>
		new Response(new Uint8Array(bytes), {
			headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes), ...headers }
		});

	it('fetches a file through the relay without the token, as a Blob of its type', async () => {
		const { notion, fetch } = client(() => image(10, { 'Content-Type': 'image/PNG; x=1' }));
		const result = await notion.file(LINK, 100);
		expect(result.ok).toBe(true);
		const blob = (result as { blob: Blob }).blob;
		expect([blob.size, blob.type]).toEqual([10, 'image/png']);
		const [url, init] = fetch.mock.calls[0]!;
		expect(String(url)).toBe(`${RELAY}/file?url=${encodeURIComponent(LINK)}`);
		expect(init).toMatchObject({
			method: 'GET',
			credentials: 'omit',
			cache: 'no-store',
			referrerPolicy: 'no-referrer'
		});
		expect(init!.headers).toBeUndefined();
		expect(JSON.stringify(fetch.mock.calls)).not.toContain(TOKEN);
	});

	it('says why it kept no file: too large, not an image, or failed', async () => {
		const cases: [Response, string][] = [
			[image(101), 'too-large'],
			// No length given, and longer than allowed.
			[
				new Response(new Uint8Array(101), { headers: { 'Content-Type': 'image/png' } }),
				'too-large'
			],
			[new Response('<html>', { headers: { 'Content-Type': 'text/html' } }), 'not-image'],
			[new Response('x', { headers: {} }), 'not-image'],
			[Response.json({ code: 'relay_file_too_large' }, { status: 413 }), 'too-large'],
			[Response.json({ code: 'relay_file_type' }, { status: 415 }), 'not-image'],
			[Response.json({ code: 'relay_file' }, { status: 502 }), 'failed'],
			[Response.json({ code: 'relay_upstream' }, { status: 502 }), 'failed'],
			[Response.json({ code: 'relay_forbidden' }, { status: 403 }), 'failed']
		];
		for (const [response, reason] of cases) {
			const { notion } = client(() => response);
			expect(await notion.file(LINK, 100), reason).toEqual({ ok: false, reason });
		}
		// A body that breaks off (the relay's limit, or a dropped connection).
		const { notion } = client(
			() =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new Uint8Array(4));
							controller.error(new Error('cut'));
						}
					}),
					{ headers: { 'Content-Type': 'image/png' } }
				)
		);
		expect(await notion.file(LINK, 100)).toEqual({ ok: false, reason: 'failed' });
	});

	it('throws only when offline or aborted', async () => {
		const offline = client(() => {
			throw new TypeError('network');
		});
		await expect(offline.notion.file(LINK, 100)).rejects.toMatchObject({ kind: 'offline' });
		const controller = new AbortController();
		const { notion } = client(
			(_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
				}),
			{ signal: controller.signal }
		);
		const pending = notion.file(LINK, 100);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
		await expect(notion.file(LINK, 100)).rejects.toMatchObject({ kind: 'aborted' });
	});
});
