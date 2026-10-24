import { describe, expect, it, vi } from 'vitest';
import { NotionError, createNotionClient, type RawBlock } from './api.js';
import { DOCUMENT_VERSION, type Block, type NotionDocument } from './document.js';
import {
	COPY_LIMIT,
	IMAGE_LIMIT,
	MAX_IMAGES,
	SOURCE_IMAGES_LIMIT,
	TOTAL_LIMIT,
	dataSources,
	download,
	fitCopy,
	fromToday,
	imageIds,
	imageKey,
	newestQuery,
	parseCopies,
	parseSources,
	resolve,
	type Source,
	type SourceClient
} from './sources.js';

const PAGE = '0c940186-ab70-4351-bb34-2d16f0635d49';
const DS = '59833787-2cf9-4fdf-8782-e53db20768a5';
const PARENT = '11111111-2222-4333-8444-555555555555';

const page = (id: string, title = 'Agenda') => ({
	object: 'page',
	id,
	created_time: '2026-10-22T06:00:00.000Z',
	properties: { Name: { type: 'title', title: [{ plain_text: title }] } }
});

/** A client whose answers come from `answers`, recording what it was asked. */
function fake(answers: Partial<Record<keyof SourceClient, (...args: never[]) => unknown>> = {}) {
	return {
		page: vi.fn(async (id: string) => page(id)),
		database: vi.fn(async (id: string) => ({ object: 'database', id, data_sources: [] })),
		dataSource: vi.fn(async (id: string) => ({
			object: 'data_source',
			id,
			properties: { Day: { type: 'date' }, Title: { type: 'title' } }
		})),
		query: vi.fn(async () => ({ results: [page('q1')], has_more: false, next_cursor: null })),
		allChildren: vi.fn(async (): Promise<RawBlock[]> => []),
		blocks: vi.fn(async () => ({
			blocks: [{ id: 'b', type: 'divider', divider: {} }] as RawBlock[],
			truncated: false
		})),
		...answers
	} as unknown as SourceClient & Record<string, ReturnType<typeof vi.fn>>;
}

const page1: Source = { id: 's0', label: 'Page', kind: 'page', page: PAGE };

const database = (extra: Partial<Extract<Source, { kind: 'database' }>> = {}) =>
	({
		id: 's1',
		label: 'Agenda',
		kind: 'database',
		dataSource: DS,
		sort: { by: 'created' },
		...extra
	}) as Extract<Source, { kind: 'database' }>;

describe('finding the page', () => {
	it('lists a database’s data sources', async () => {
		const client = fake({
			database: async () => ({
				object: 'database',
				id: PAGE,
				data_sources: [{ id: DS, name: 'Tasks' }, { id: PARENT }, { name: 'no id' }]
			})
		});
		expect(await dataSources(client, PAGE)).toEqual([
			{ id: DS, name: 'Tasks' },
			{ id: PARENT, name: '' }
		]);
		expect(await dataSources(fake(), PAGE)).toEqual([]);
	});

	it('asks a database for its newest page, by created time or a date, by title', () => {
		expect(newestQuery(database())).toEqual({
			page_size: 1,
			sorts: [{ timestamp: 'created_time', direction: 'descending' }]
		});
		expect(newestQuery(database({ sort: { by: 'property', property: 'Day' } }))).toEqual({
			page_size: 1,
			sorts: [{ property: 'Day', direction: 'descending' }],
			filter: { property: 'Day', date: { is_not_empty: true } }
		});
		expect(
			newestQuery(database({ sort: { by: 'property', property: 'Day' }, title: 'Agenda' }), 'Title')
		).toEqual({
			page_size: 1,
			sorts: [{ property: 'Day', direction: 'descending' }],
			filter: {
				and: [
					{ property: 'Day', date: { is_not_empty: true } },
					{ property: 'Title', title: { contains: 'Agenda' } }
				]
			}
		});
		expect(newestQuery(database({ title: 'Agenda' }), 'Title')).toMatchObject({
			filter: { property: 'Title', title: { contains: 'Agenda' } }
		});
	});

	it('resolves each kind of source', async () => {
		const client = fake({
			allChildren: async () => [
				{ id: 'first', type: 'child_page' },
				{ id: 'text', type: 'paragraph' },
				{ id: 'last', type: 'child_page' },
				{ id: 'db', type: 'child_database' }
			]
		});
		expect(await resolve(client, { id: 's', label: 'L', kind: 'page', page: PAGE })).toBe(PAGE);
		expect(await resolve(client, database())).toBe('q1');
		expect(client.dataSource).not.toHaveBeenCalled();
		expect(await resolve(client, database({ title: 'Agenda' }))).toBe('q1');
		expect(client.dataSource).toHaveBeenCalledWith(DS);
		expect(client.query).toHaveBeenLastCalledWith(DS, {
			page_size: 1,
			sorts: [{ timestamp: 'created_time', direction: 'descending' }],
			filter: { property: 'Title', title: { contains: 'Agenda' } }
		});
		expect(await resolve(client, { id: 's', label: 'L', kind: 'child', parent: PARENT })).toBe(
			'last'
		);

		// A title filter it can't apply fails rather than matching every page.
		const untitled = fake({ dataSource: async () => ({ object: 'data_source', properties: {} }) });
		await expect(resolve(untitled, database({ title: 'Agenda' }))).rejects.toMatchObject({
			kind: 'failed'
		});
		expect(untitled.query).not.toHaveBeenCalled();

		const empty = fake({
			query: async () => ({ results: [], has_more: false, next_cursor: null })
		});
		expect(await resolve(empty, database())).toBeUndefined();
		expect(
			await resolve(fake(), { id: 's', label: 'L', kind: 'child', parent: PARENT })
		).toBeUndefined();
	});
});

describe('download', () => {
	it('downloads the page a source points at, in the saved format', async () => {
		const client = fake();
		const copy = await download(client, database(), () => 42);
		expect(copy).toMatchObject({
			v: DOCUMENT_VERSION,
			id: 'q1',
			title: 'Agenda',
			blocks: [{ type: 'divider' }],
			fetchedAt: 42,
			truncated: false
		});
		expect(client.page).toHaveBeenCalledWith('q1');
		expect(client.blocks).toHaveBeenCalledWith('q1');
		expect(
			await download(
				fake({ query: async () => ({ results: [], has_more: false, next_cursor: null }) }),
				database()
			)
		).toBeUndefined();
	});

	it('works through the real client and relay protocol, and passes failures on', async () => {
		const fetch = vi.fn(async (input: string | URL | Request) => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith('/query'))
				return Response.json({ results: [{ id: PAGE }], has_more: false, next_cursor: null });
			if (path.startsWith('/v1/pages/')) return Response.json(page(PAGE, 'Thursday'));
			return Response.json({ results: [], has_more: false, next_cursor: null });
		});
		const client = createNotionClient({
			relay: 'https://relay.example',
			token: 't',
			fetch,
			sleep: async () => {}
		});
		expect(await download(client, database())).toMatchObject({ id: PAGE, title: 'Thursday' });

		const refused = createNotionClient({
			relay: 'https://relay.example',
			token: 't',
			fetch: async () => new Response('{"code":"object_not_found"}', { status: 404 }),
			sleep: async () => {}
		});
		const error = await download(refused, database()).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NotionError);
		expect(error).toMatchObject({ kind: 'not-shared' });
	});
});

describe('download with images (#108)', () => {
	const S3 = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/ws';
	const img = (id: string, link: string): RawBlock => ({
		id,
		type: 'image',
		image: { type: 'file', file: { url: link }, caption: [] }
	});
	const ext: RawBlock = {
		id: 'e',
		type: 'image',
		image: { type: 'external', external: { url: 'https://a.example/i.png' }, caption: [] }
	};

	/** An image store in memory; `full` makes saving fail. */
	function memory(saved: Record<string, { id: string; size: number }> = {}, full = false) {
		const blobs = new Map<string, Blob>();
		let next = 0;
		return {
			blobs,
			find: vi.fn((key: string) => saved[key]),
			save: vi.fn(async (blob: Blob, key: string) => {
				if (full) return false as const;
				const id = `blob${++next}`;
				blobs.set(id, blob);
				saved[key] = { id, size: blob.size };
				return id;
			})
		};
	}
	const files = (sizes: Record<string, number | 'not-image' | 'failed'>) =>
		vi.fn(async (link: string) => {
			const size = sizes[new URL(link).pathname.split('/').pop()!];
			if (typeof size === 'number')
				return size > IMAGE_LIMIT
					? { ok: false as const, reason: 'too-large' as const }
					: { ok: true as const, blob: new Blob([new Uint8Array(size)], { type: 'image/png' }) };
			return { ok: false as const, reason: size ?? ('failed' as const) };
		});

	it('saves the images Notion hosts, reuses saved ones, and says why others are missing', async () => {
		const client = fake({
			blocks: async () => ({
				blocks: [
					img('1', `${S3}/a.png?sig=1`),
					// The same file again, under a fresh signature: saved once.
					img('2', `${S3}/a.png?sig=2`),
					img('3', `${S3}/kept.png?sig=3`),
					{
						id: 't',
						type: 'toggle',
						toggle: { rich_text: [] },
						children: [img('4', `${S3}/b.gif`)]
					},
					img('5', `${S3}/huge.png`),
					img('6', `${S3}/page.html`),
					img('7', `${S3}/gone.png`),
					ext
				] as RawBlock[],
				truncated: false
			}),
			file: files({
				'a.png': 10,
				'b.gif': 20,
				'huge.png': IMAGE_LIMIT + 1,
				'page.html': 'not-image'
			})
		});
		const store = memory({ [`${S3}/kept.png`]: { id: 'old', size: 5 } });
		const copy = (await download(client, page1, () => 1, store))!;
		const blocks = copy.blocks as Block[];
		expect(blocks.slice(0, 3)).toEqual([
			{ type: 'image', caption: [], file: 'blob1' },
			{ type: 'image', caption: [], file: 'blob1' },
			{ type: 'image', caption: [], file: 'old' }
		]);
		expect(blocks[3]).toMatchObject({ children: [{ type: 'image', file: 'blob2' }] });
		expect(blocks.slice(4)).toEqual([
			{ type: 'image', caption: [], skipped: 'too-large' },
			{ type: 'image', caption: [], skipped: 'not-image' },
			{ type: 'image', caption: [], skipped: 'failed' },
			{ type: 'image', caption: [], external: 'https://a.example/i.png' }
		]);
		// Saved by file, without the signature; only files Notion hosts were fetched.
		expect(store.save.mock.calls.map(([, key]) => key)).toEqual([`${S3}/a.png`, `${S3}/b.gif`]);
		expect((client.file as ReturnType<typeof vi.fn>).mock.calls.map(([link]) => link)).toEqual([
			`${S3}/a.png?sig=1`,
			`${S3}/b.gif`,
			`${S3}/huge.png`,
			`${S3}/page.html`,
			`${S3}/gone.png`
		]);
		expect(imageIds(copy)).toEqual(new Set(['blob1', 'old', 'blob2']));
		expect(JSON.stringify(copy)).not.toContain('sig=');
		expect(imageKey(`${S3}/a.png?sig=1#x`)).toBe(`${S3}/a.png`);
	});

	it('stops at the caps for a source, and says when an image couldn’t be saved', async () => {
		const many = Array.from({ length: MAX_IMAGES + 2 }, (_, i) => img(`${i}`, `${S3}/${i}.png`));
		const sizes = Object.fromEntries(many.map((_, i) => [`${i}.png`, 1]));
		const client = fake({
			blocks: async () => ({ blocks: many, truncated: false }),
			file: files(sizes)
		});
		const copy = (await download(client, page1, () => 1, memory()))!;
		const skipped = copy.blocks.filter((b) => b.type === 'image' && b.skipped === 'full');
		expect(skipped).toHaveLength(2);
		expect(client.file).toHaveBeenCalledTimes(MAX_IMAGES);

		// Four images at the cap for one fill a source's allowance exactly; a fifth is past it.
		const big = IMAGE_LIMIT;
		expect(SOURCE_IMAGES_LIMIT).toBe(4 * IMAGE_LIMIT);
		const names = ['1', '2', '3', '4', '5', '6'];
		const heavy = fake({
			blocks: async () => ({
				blocks: names.map((n) => img(n, `${S3}/${n}.png`)),
				truncated: false
			}),
			file: files({
				'1.png': big,
				'2.png': big,
				'3.png': big,
				'4.png': big,
				'5.png': big,
				'6.png': 0
			})
		});
		const capped = (await download(heavy, page1, () => 1, memory()))!;
		const outcome = (b: Block) => (b.type === 'image' ? (b.file ?? b.skipped) : b.type);
		expect(capped.blocks.map(outcome)).toEqual([
			'blob1',
			'blob2',
			'blob3',
			'blob4',
			'full',
			'blob5'
		]);

		const nowhere = (await download(heavy, page1, () => 1, memory({}, true)))!;
		expect(nowhere.blocks.every((b) => b.type === 'image' && b.skipped === 'not-saved')).toBe(true);
		// Without a store, nothing is fetched.
		const plain = fake({ blocks: heavy.blocks, file: vi.fn() });
		const none = (await download(plain, page1))!;
		expect(none.blocks[0]).toEqual({ type: 'image', caption: [], skipped: 'not-downloaded' });
		expect(plain.file).not.toHaveBeenCalled();
	});

	it('fails the whole download when offline mid-way', async () => {
		const client = fake({
			blocks: async () => ({ blocks: [img('1', `${S3}/1.png`)], truncated: false }),
			file: vi.fn(async () => {
				throw new NotionError('offline');
			})
		});
		await expect(download(client, page1, () => 1, memory())).rejects.toMatchObject({
			kind: 'offline'
		});
	});
});

describe('fromToday', () => {
	it('compares dates where the person is', () => {
		const now = new Date(2026, 9, 22, 8, 30).getTime();
		expect(fromToday(new Date(2026, 9, 22, 0, 5).toISOString(), now)).toBe(true);
		expect(fromToday(new Date(2026, 9, 21, 23, 55).toISOString(), now)).toBe(false);
		expect(fromToday(new Date(2025, 9, 22, 8).toISOString(), now)).toBe(false);
		// A date property's bare date is on the person's calendar.
		expect(fromToday('2026-10-22', now)).toBe(true);
		expect(fromToday('2026-10-21', now)).toBe(false);
		expect(fromToday(null, now)).toBe(false);
		expect(fromToday('not a date', now)).toBe(false);
	});
});

describe('size caps', () => {
	const doc = (id: string, size: number): NotionDocument => ({
		v: DOCUMENT_VERSION,
		id,
		title: 'x'.repeat(size),
		icon: null,
		url: null,
		createdTime: null,
		properties: [],
		blocks: [],
		fetchedAt: 0,
		truncated: false
	});

	it('refuses a copy over 1 MB, or one that takes all copies over 2 MB', () => {
		expect(fitCopy({}, 'a', doc('a', 1000))).toBe('ok');
		expect(fitCopy({}, 'a', doc('a', COPY_LIMIT))).toBe('too-large');
		const big = COPY_LIMIT - 500;
		expect(fitCopy({ b: doc('b', big) }, 'a', doc('a', big))).toBe('ok');
		expect(fitCopy({ b: doc('b', big), c: doc('c', big) }, 'a', doc('a', big))).toBe('full');
		// Replacing its own copy doesn't count the old one.
		expect(fitCopy({ a: doc('a', big), b: doc('b', big) }, 'a', doc('a', big))).toBe('ok');
		// Bytes, not characters.
		const wide = { ...doc('a', 0), title: '✓'.repeat(COPY_LIMIT / 2) };
		expect(fitCopy({}, 'a', wide)).toBe('too-large');
		expect(TOTAL_LIMIT).toBe(2 * COPY_LIMIT);
	});
});

describe('saved entries', () => {
	const sources: Source[] = [
		{ id: 'a', label: 'One page', kind: 'page', page: PAGE },
		{ id: 'b', label: 'Agenda', kind: 'database', dataSource: DS, sort: { by: 'created' } },
		{
			id: 'c',
			label: 'By day',
			kind: 'database',
			dataSource: DS,
			sort: { by: 'property', property: 'Day' },
			title: 'Agenda'
		},
		{ id: 'd', label: 'Journal', kind: 'child', parent: PARENT }
	];

	it('takes valid sources and refuses anything else', () => {
		expect(parseSources(sources)).toEqual(sources);
		expect(parseSources([])).toEqual([]);
		for (const bad of [
			null,
			{},
			'[]',
			[null],
			[{ ...sources[0], id: '' }],
			[{ ...sources[0], label: '  ' }],
			[{ ...sources[0], label: 'x'.repeat(201) }],
			[{ ...sources[0], page: 'not-an-id' }],
			[{ ...sources[0], page: PAGE.toUpperCase() }],
			[{ ...sources[0], kind: 'web' }],
			[{ ...sources[1], sort: { by: 'edited' } }],
			[{ ...sources[1], sort: { by: 'property' } }],
			[{ ...sources[2], title: 42 }],
			[{ ...sources[3], parent: undefined }],
			[sources[0], sources[0]]
		]) {
			expect(parseSources(bad), JSON.stringify(bad)).toBeUndefined();
		}
		// Unknown fields are dropped, not kept.
		expect(parseSources([{ ...sources[0], extra: 1 }])).toEqual([sources[0]]);
	});

	it('takes saved copies and refuses other shapes', () => {
		const copy = {
			v: DOCUMENT_VERSION,
			id: PAGE,
			title: 'T',
			icon: null,
			url: null,
			createdTime: null,
			properties: [],
			blocks: [],
			fetchedAt: 1,
			truncated: false
		};
		expect(parseCopies({})).toEqual({});
		expect(parseCopies({ a: copy })).toEqual({ a: copy });
		for (const bad of [
			null,
			[],
			'x',
			{ a: null },
			{ a: { ...copy, v: 2 } },
			{ a: { ...copy, blocks: {} } }
		])
			expect(parseCopies(bad)).toBeUndefined();
	});
});
