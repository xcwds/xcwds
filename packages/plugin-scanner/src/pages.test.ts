import { createBlobs, memoryBlobs, type BlobBackend } from '@xcwds/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	PAGE_MESSAGES,
	createPages,
	pageCollection,
	parsePageMeta,
	type PageInput,
	type PageMeta
} from './pages.js';
import { jpegInfo, writePdf } from './pdf.js';

/**
 * A JPEG's structure (not a decodable image): a comment holding `tag`, a frame for
 * `width`×`height`, one scan, the end.
 */
function jpegBytes(width = 10, height = 14, tag = 0): Uint8Array {
	return new Uint8Array([
		...[0xff, 0xd8],
		...[0xff, 0xfe, 0x00, 0x03, tag],
		...[0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff],
		...[0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01],
		...[0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34],
		...[0xff, 0xd9]
	]);
}

const page = (tag = 0, width = 10, height = 14): PageInput => ({
	blob: new Blob([jpegBytes(width, height, tag) as BlobPart], { type: 'image/jpeg' }),
	width,
	height
});

/** The tag byte of a page's image (see `jpegBytes`). */
const tagOf = async (blob: Blob | undefined) => new Uint8Array(await blob!.arrayBuffer())[6];

function store(backend: BlobBackend & { rows: Map<string, unknown> } = memoryBlobs()) {
	const blobs = createBlobs({ backend }).scope('scanner');
	const persist = vi.spyOn(blobs, 'persist').mockResolvedValue('granted');
	let n = 0;
	const pages = createPages(blobs, {}, { newId: () => `p${++n}` });
	return { backend, blobs, persist, pages };
}

/** The pages' ids, in order. */
const ids = async (pages: ReturnType<typeof store>['pages']) =>
	(await pages.list()).map((p) => p.id);

afterEach(() => vi.restoreAllMocks());

describe('pageCollection', () => {
	it('is personal and out of backups, as app:scanner:pages', () => {
		const { pages } = store();
		expect(pages.collection).toMatchObject({
			key: 'app:scanner:pages',
			label: 'Scanned pages',
			group: 'scanner',
			sensitive: true,
			backup: false
		});
	});

	it('takes its own key, label and group', () => {
		expect(pageCollection({ key: 'receipts', label: 'Receipts', group: 'docs' })).toMatchObject({
			key: 'receipts',
			label: 'Receipts',
			group: 'docs'
		});
		expect(pageCollection()).not.toHaveProperty('group');
	});
});

describe('parsePageMeta', () => {
	const good: PageMeta = { page: 'a', rev: 0, order: 1.5, width: 10, height: 20, filter: 'bw' };

	it('keeps a valid meta, without extra fields', () => {
		expect(parsePageMeta({ ...good, extra: 1 })).toEqual(good);
		expect(parsePageMeta({ ...good, order: -3 })).toEqual({ ...good, order: -3 });
	});

	it.each([
		['not an object', 'x'],
		['null', null],
		['no page id', { ...good, page: '' }],
		['a negative rev', { ...good, rev: -1 }],
		['a fractional rev', { ...good, rev: 0.5 }],
		['an infinite order', { ...good, order: Infinity }],
		['a zero width', { ...good, width: 0 }],
		['a fractional height', { ...good, height: 2.5 }],
		['an unknown filter', { ...good, filter: 'sepia' }]
	])('refuses %s', (_, raw) => {
		expect(parsePageMeta(raw)).toBeUndefined();
	});
});

describe('createPages', () => {
	it('adds pages at the end and lists them in order', async () => {
		const { pages } = store();
		expect(await pages.add(page(1))).toEqual({ ok: true, id: 'p1' });
		expect(await pages.add({ ...page(2, 20, 30), filter: 'greyscale' })).toEqual({
			ok: true,
			id: 'p2'
		});
		const list = await pages.list();
		expect(list).toMatchObject([
			{ id: 'p1', width: 10, height: 14, filter: 'original' },
			{ id: 'p2', width: 20, height: 30, filter: 'greyscale' }
		]);
		expect(list[0]!.size).toBe(jpegBytes().length);
		expect(await tagOf(await pages.get('p2'))).toBe(2);
		expect(await pages.get('nope')).toBeUndefined();
	});

	it('survives a reload: a new store over the same storage lists the same pages', async () => {
		const first = store();
		await first.pages.add(page(1));
		await first.pages.add(page(2));
		await first.pages.move('p2', 0);
		const again = createPages(createBlobs({ backend: first.backend }).scope('scanner'));
		expect(await ids(again)).toEqual(['p2', 'p1']);
	});

	it('asks to persist storage once, after the first page', async () => {
		const { pages, persist } = store();
		await pages.add(page());
		await pages.add(page());
		expect(persist).toHaveBeenCalledOnce();
	});

	it('refuses what isn’t a JPEG page', async () => {
		const { pages, backend } = store();
		const png = { ...page(), blob: new Blob(['x'], { type: 'image/png' }) };
		expect(await pages.add(png)).toEqual({ ok: false, error: PAGE_MESSAGES.type });
		expect(await pages.add({ ...page(), blob: 'x' as unknown as Blob })).toEqual({
			ok: false,
			error: PAGE_MESSAGES.type
		});
		expect(await pages.add({ ...page(), width: 0 })).toEqual({
			ok: false,
			error: PAGE_MESSAGES.size
		});
		expect(await pages.add({ ...page(), filter: 'sepia' as never })).toEqual({
			ok: false,
			error: PAGE_MESSAGES.filter
		});
		expect(backend.rows.size).toBe(0);
	});

	it('says so when storage is full', async () => {
		const backend = memoryBlobs();
		backend.put = async () => {
			throw new DOMException('full', 'QuotaExceededError');
		};
		const { pages, persist } = store(backend);
		expect(await pages.add(page())).toEqual({ ok: false, error: PAGE_MESSAGES.full });
		expect(persist).not.toHaveBeenCalled();
	});

	it('says so when it can’t make an id', async () => {
		const blobs = createBlobs({ backend: memoryBlobs() }).scope('scanner');
		const pages = createPages(blobs, {}, { newId: () => undefined });
		expect(await pages.add(page())).toEqual({ ok: false, error: PAGE_MESSAGES.full });
	});

	it('retakes a page in its place, keeping one copy', async () => {
		const { pages, backend } = store();
		await pages.add(page(1));
		await pages.add(page(2));
		await pages.add(page(3));
		expect(await pages.retake('p2', { ...page(9, 30, 40), filter: 'bw' })).toEqual({
			ok: true,
			id: 'p2'
		});
		expect(await pages.list()).toMatchObject([
			{ id: 'p1' },
			{ id: 'p2', width: 30, height: 40, filter: 'bw' },
			{ id: 'p3' }
		]);
		expect(await tagOf(await pages.get('p2'))).toBe(9);
		expect(backend.rows.size).toBe(3);
	});

	it('refuses to retake a page that’s gone, or with a bad image', async () => {
		const { pages } = store();
		expect(await pages.retake('p1', page())).toEqual({ ok: false, error: PAGE_MESSAGES.missing });
		await pages.add(page(1));
		expect(await pages.retake('p1', { ...page(), height: -1 })).toEqual({
			ok: false,
			error: PAGE_MESSAGES.size
		});
		expect(await tagOf(await pages.get('p1'))).toBe(1);
	});

	it('keeps the old image when a retake can’t be saved', async () => {
		const { pages, backend } = store();
		await pages.add(page(1));
		backend.put = async () => {
			throw new DOMException('full', 'QuotaExceededError');
		};
		expect(await pages.retake('p1', page(2))).toEqual({ ok: false, error: PAGE_MESSAGES.full });
		expect(await tagOf(await pages.get('p1'))).toBe(1);
	});

	it('moves pages to the front, the middle and the end', async () => {
		const { pages, backend } = store();
		for (const tag of [1, 2, 3, 4]) await pages.add(page(tag));
		expect(await pages.move('p4', 0)).toBe(true);
		expect(await ids(pages)).toEqual(['p4', 'p1', 'p2', 'p3']);
		expect(await pages.move('p4', 2)).toBe(true);
		expect(await ids(pages)).toEqual(['p1', 'p2', 'p4', 'p3']);
		expect(await pages.move('p1', 99)).toBe(true);
		expect(await ids(pages)).toEqual(['p2', 'p4', 'p3', 'p1']);
		expect(await pages.move('p3', -5)).toBe(true);
		expect(await ids(pages)).toEqual(['p3', 'p2', 'p4', 'p1']);
		// Moving keeps each page's image, one copy each.
		expect(
			await Promise.all((await ids(pages)).map(async (id) => tagOf(await pages.get(id))))
		).toEqual([3, 2, 4, 1]);
		expect(backend.rows.size).toBe(4);
		// A page added after the moves still goes last.
		await pages.add(page(5));
		expect((await ids(pages)).at(-1)).toBe('p5');
	});

	it('moves a page in place, or one that’s gone, without saving anything', async () => {
		const { pages, backend } = store();
		await pages.add(page(1));
		await pages.add(page(2));
		const put = vi.spyOn(backend, 'put');
		expect(await pages.move('p1', 0)).toBe(true);
		expect(await pages.move('nope', 0)).toBe(false);
		expect(await pages.move('p1', Number.NaN)).toBe(false);
		expect(put).not.toHaveBeenCalled();
	});

	it('renumbers the pages when halving runs out of room between two', async () => {
		const { pages, backend } = store();
		for (const tag of [1, 2, 3, 4]) await pages.add(page(tag));
		const put = vi.spyOn(backend, 'put');
		// Squeezing the last page in after the second (order 1), over and over, halves the gap
		// each time, until there's no number left between 1 and the next.
		for (let i = 0; i < 80; i++) {
			const order = await ids(pages);
			expect(await pages.move(order.at(-1)!, 2)).toBe(true);
			expect((await ids(pages))[2]).toBe(order.at(-1));
		}
		// One save per move, plus the renumbering's.
		expect(put.mock.calls.length).toBeGreaterThan(80);
		const list = await ids(pages);
		expect(new Set(list).size).toBe(4);
		expect(list.slice(0, 2)).toEqual(['p1', 'p2']);
	});

	it('runs this tab’s changes one at a time', async () => {
		const { pages } = store();
		for (const tag of [1, 2, 3]) await pages.add(page(tag));
		await Promise.all([pages.move('p3', 0), pages.move('p2', 0), pages.add(page(4))]);
		expect(await ids(pages)).toEqual(['p2', 'p3', 'p1', 'p4']);
	});

	it('lets the newer copy win when a tab died mid-move, and tidies the older one', async () => {
		const { pages, blobs, backend } = store();
		await pages.add(page(1));
		await pages.add(page(2));
		// What a move leaves when the tab dies after saving the new copy: both copies.
		const meta = (await blobs.list(pages.collection)).find((r) => r.meta?.page === 'p1')!.meta!;
		await blobs.put(pages.collection, (await pages.get('p1'))!, { ...meta, rev: 1, order: 5 });
		expect(backend.rows.size).toBe(3);
		expect(await ids(pages)).toEqual(['p2', 'p1']);
		expect(backend.rows.size).toBe(2);
	});

	it('leaves out a copy whose meta doesn’t pass', async () => {
		const backend = memoryBlobs();
		const { pages } = store(backend);
		await pages.add(page(1));
		const [row] = [...backend.rows.values()];
		row!.meta = { page: 'p1', rev: 0 };
		expect(await pages.list()).toEqual([]);
	});

	it('deletes a page and every copy of it', async () => {
		const { pages, backend } = store();
		await pages.add(page(1));
		await pages.add(page(2));
		expect(await pages.delete('p1')).toBe(true);
		expect(await ids(pages)).toEqual(['p2']);
		expect(backend.rows.size).toBe(1);
		expect(await pages.delete('p1')).toBe(true);
	});

	it('says so when a delete fails', async () => {
		const { pages, backend } = store();
		await pages.add(page(1));
		backend.delete = async () => {
			throw new Error('blocked');
		};
		expect(await pages.delete('p1')).toBe(false);
	});

	it('starts over', async () => {
		const { pages, backend } = store();
		await pages.add(page(1));
		await pages.add(page(2));
		expect(await pages.clear()).toBe(true);
		expect(await pages.list()).toEqual([]);
		expect(backend.rows.size).toBe(0);
	});

	it('hands over the JPEGs in order, ready for a PDF', async () => {
		const { pages } = store();
		await pages.add(page(1, 10, 14));
		await pages.add(page(2, 30, 20));
		await pages.move('p2', 0);
		const jpegs = await pages.jpegs();
		expect(jpegs.map((j) => j[6])).toEqual([2, 1]);
		expect(jpegs.map((j) => jpegInfo(j))).toMatchObject([
			{ width: 30, height: 20 },
			{ width: 10, height: 14 }
		]);
		const pdf = new TextDecoder().decode(writePdf(jpegs));
		expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2);
	});

	it('tells listeners about this tab’s changes and clears, until they stop', async () => {
		const { pages } = store();
		const listener = vi.fn();
		const stop = pages.onChange(listener);
		await pages.add(page(1));
		await pages.add(page(2));
		await pages.retake('p1', page(3));
		await pages.move('p2', 0);
		await pages.delete('p1');
		await pages.clear();
		expect(listener).toHaveBeenCalledTimes(6);
		stop();
		await pages.add(page(4));
		expect(listener).toHaveBeenCalledTimes(6);
	});

	it('ignores other collections’ changes', async () => {
		const { pages, blobs } = store();
		const other = blobs.register({ key: 'other', label: 'Other' });
		const listener = vi.fn();
		pages.onChange(listener);
		await blobs.clear(other);
		expect(listener).not.toHaveBeenCalled();
	});
});
