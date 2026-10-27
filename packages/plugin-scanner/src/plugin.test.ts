import { pluginMeta } from '@xcwds/core';
import { buildTestApp, type Importer } from '@xcwds/testing';
import { describe, expect, it, vi } from 'vitest';
import client, { SCANNING, scannerPlugin } from './client.js';
import { ENCODE_ERROR, encodeJpeg } from './encode.js';
import { rectangle, type Quad } from './geometry.js';
import scannerFactory, { build } from './index.js';
import { resolveOptions } from './options.js';
import type { Pixels } from './warp.js';

// Node has no canvas: a stand-in JPEG that says what it was made from.
vi.mock('./encode.js', async (original) => {
	const actual = await original<typeof import('./encode.js')>();
	return {
		...actual,
		encodeJpeg: vi.fn(
			async (page: Pixels) => new Blob([`${page.width}x${page.height}`], { type: 'image/jpeg' })
		)
	};
});

const importer: Importer = async (id) => {
	const entries: Record<string, () => Promise<Record<string, unknown>>> = {
		'@xcwds/plugin-scanner': () => import('./index.js'),
		'@xcwds/plugin-scanner/client': () => import('./client.js')
	};
	const load = entries[id];
	if (!load) throw Object.assign(new Error(id), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
	return load();
};

/** A white photo, the size of A4 at 30 px per 21 mm. */
const photo: Pixels = { width: 30, height: 42, data: new Uint8ClampedArray(30 * 42 * 4).fill(255) };
const whole = rectangle(30, 42);

/** Pages made on the page, not in a Worker (Node has none). */
const onPage = () => scannerPlugin({ processor: { worker: () => null } });

describe('options', () => {
	it('takes the collection key, and refuses mistakes', async () => {
		expect(resolveOptions()).toEqual({});
		expect(resolveOptions({ collection: 'receipts' })).toEqual({ collection: 'receipts' });
		for (const collection of ['', 'Has Space', 'a:b', 3])
			expect(() => resolveOptions({ collection })).toThrow(/`collection`/);
		expect(() => resolveOptions({ paper: 'a4' })).toThrow(/unknown option `paper`/);
		expect(() => resolveOptions([])).toThrow(/must be an object/);
		expect(scannerFactory().name).toBe('@xcwds/plugin-scanner');
		await expect(
			buildTestApp({ plugins: [scannerFactory({ collection: 'No' })] }, { import: importer })
		).rejects.toThrow(/@xcwds\/plugin-scanner: `collection`/);
	});

	it('loads from a config, makes no network requests, and gives the app `app.scanner`', async () => {
		const app = await buildTestApp({ plugins: [scannerFactory()] }, { import: importer });
		expect(app.scanner?.busy).toBe(false);
		expect(app.scanner?.pages.collection).toMatchObject({
			key: 'app:scanner:pages',
			group: 'scanner',
			sensitive: true,
			backup: false
		});
		await app.close();
		expect(pluginMeta(build).network).toBe(false);
		expect(pluginMeta(client).network).toBe(false);
	});

	it('keeps the pages under the `collection` key', async () => {
		const app = await buildTestApp({ plugins: [[onPage(), { collection: 'receipts' }]] });
		expect(app.scanner!.pages.collection.key).toBe('app:scanner:receipts');
		await app.close();
	});
});

describe('app.scanner', () => {
	it('makes and saves a page, holding updates back until it is saved', async () => {
		const app = await buildTestApp({ plugins: [[onPage(), {}]] });
		const scanner = app.scanner!;
		const reasons = () => app.hooks.collect('onBeforeReload', []);
		const changes = vi.fn();
		scanner.onChange(changes);
		expect(await reasons()).toEqual([]);

		const scanning = scanner.scan(photo, whole, { filter: 'greyscale' });
		expect(scanner.busy).toBe(true);
		expect(await reasons()).toEqual([SCANNING]);
		const result = await scanning;
		expect(result).toMatchObject({ ok: true, paper: 'a4' });
		expect(scanner.busy).toBe(false);
		expect(changes).toHaveBeenCalledTimes(2);
		expect(await reasons()).toEqual([]);

		const [page] = await scanner.pages.list();
		expect(page).toMatchObject({ id: result.ok && result.id, filter: 'greyscale' });
		expect(await (await scanner.pages.get(page!.id))?.text()).toBe('30x42');
		// The photo stays as it was, for another crop.
		expect(photo.data.every((v) => v === 255)).toBe(true);
		await app.close();
	});

	it('replaces a page in its place with `retake`', async () => {
		const app = await buildTestApp({ plugins: [[onPage(), {}]] });
		const scanner = app.scanner!;
		const first = await scanner.scan(photo, whole);
		await scanner.scan(photo, whole);
		const half: Quad = [
			{ x: 0, y: 0 },
			{ x: 15, y: 0 },
			{ x: 15, y: 21 },
			{ x: 0, y: 21 }
		];
		const again = await scanner.scan(photo, half, { retake: first.ok ? first.id : '' });
		expect(again).toMatchObject({ ok: true, id: first.ok && first.id });
		const pages = await scanner.pages.list();
		expect(pages.map((p) => p.id)[0]).toBe(first.ok && first.id);
		expect(await (await scanner.pages.get(pages[0]!.id))?.text()).toBe('15x21');
		expect(await scanner.scan(photo, whole, { retake: 'gone' })).toEqual({
			ok: false,
			error: 'That page is no longer here.'
		});
		await app.close();
	});

	it('says why when no JPEG can be made, and rejects a request that can’t be met', async () => {
		const app = await buildTestApp({ plugins: [[onPage(), {}]] });
		const scanner = app.scanner!;
		vi.mocked(encodeJpeg).mockResolvedValueOnce(null);
		expect(await scanner.scan(photo, whole)).toEqual({ ok: false, error: ENCODE_ERROR });
		const [tl, tr, br, bl] = whole;
		await expect(scanner.scan(photo, [tl, br, tr, bl])).rejects.toThrow(RangeError);
		await expect(scanner.scan(photo, whole, { quality: 2 })).rejects.toThrow(RangeError);
		expect(scanner.busy).toBe(false);
		expect(await app.hooks.collect('onBeforeReload', [])).toEqual([]);
		expect(await scanner.pages.list()).toEqual([]);
		await app.close();
	});

	it('stops the Worker when the app closes', async () => {
		const terminate = vi.fn();
		const worker = {
			postMessage: vi.fn(),
			onmessage: null,
			onerror: null,
			terminate
		};
		const app = await buildTestApp({
			plugins: [[scannerPlugin({ processor: { worker: () => worker } }), {}]]
		});
		// The Worker never answers: closing the app gives up on the page.
		const scanning = app.scanner!.scan(photo, whole);
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
		await app.close();
		expect(terminate).toHaveBeenCalled();
		expect(await scanning).toMatchObject({ ok: false });
		expect(app.scanner!.busy).toBe(false);
	});
});
