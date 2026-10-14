import { IDBDatabase, IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, definePlugin } from './app.js';
import {
	createBlobs,
	indexedDbBlobs,
	memoryBlobs,
	type BlobBackend,
	type BlobRegistry
} from './blobs.js';
import { XcwdsError, codes } from './errors.js';
import { createStorage, memoryStorage } from './storage.js';

type Caption = { caption: string };
const isCaption = (raw: unknown): Caption | undefined =>
	typeof (raw as Caption | null)?.caption === 'string'
		? { caption: (raw as Caption).caption }
		: undefined;

const text = (blob: Blob | undefined) => blob?.text();

const opened: BlobRegistry[] = [];
function setup(backend: BlobBackend = memoryBlobs()) {
	const blobs = createBlobs({ backend });
	opened.push(blobs);
	const camera = blobs.scope('camera');
	const photos = camera.register({ key: 'photos', label: 'Photos', validate: isCaption });
	return { blobs, camera, photos, backend };
}

afterEach(() => {
	for (const b of opened.splice(0)) b.stop();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('register', () => {
	it('names collections like storage entries', () => {
		const { blobs, photos } = setup();
		expect(photos).toMatchObject({
			key: 'app:camera:photos',
			label: 'Photos',
			group: 'camera',
			namespace: 'camera',
			backup: false,
			sensitive: false
		});
		const root = blobs.scope('').register({ key: 'files', label: 'Files', sensitive: true });
		expect(root).toMatchObject({ key: 'app:files', group: 'files', sensitive: true });
		expect(blobs.collections()).toEqual([photos, root]);
	});

	it('refuses bad, duplicate and backed-up collections', () => {
		const { camera } = setup();
		const fails = (run: () => unknown, code: string) => {
			try {
				run();
			} catch (error) {
				expect(error).toBeInstanceOf(XcwdsError);
				expect((error as XcwdsError).code).toBe(code);
				return;
			}
			throw new Error('expected it to throw');
		};
		fails(() => camera.register({ key: 'photos', label: 'Again' }), codes.STORAGE_DUPLICATE_KEY);
		fails(() => camera.register({ key: 'has space', label: 'X' }), codes.STORAGE_KEY);
		fails(() => camera.register({ key: 'nolabel', label: ' ' }), codes.STORAGE_KEY);
		fails(() => camera.register({ key: 'backed', label: 'X', backup: true }), codes.STORAGE_KEY);
		fails(
			() => camera.register({ key: 'odd', label: 'X', sensitive: 'yes' as never }),
			codes.STORAGE_KEY
		);
		fails(() => camera.register({ key: 'v', label: 'X', validate: 1 as never }), codes.STORAGE_KEY);
	});

	it('refuses collections it never registered, and finds copies by key', async () => {
		const { blobs, photos } = setup();
		await expect(blobs.list({ ...photos, key: 'app:camera:nope' })).rejects.toThrow(/registered/);
		// A copy, as a page's reactive state hands back.
		const id = (await blobs.put({ ...photos }, new Blob(['x']), { caption: 'c' })) as string;
		expect((await blobs.get(photos, id))?.meta).toEqual({ caption: 'c' });
		expect(await blobs.clear([{ ...photos }])).toBe(true);
		expect(await blobs.list(photos)).toEqual([]);
	});
});

describe('put, get, list, delete', () => {
	it('saves blobs with their meta and lists them newest first', async () => {
		vi.useFakeTimers({ now: 1000, toFake: ['Date'] });
		const { blobs, photos } = setup();
		const first = await blobs.put(photos, new Blob(['one'], { type: 'text/plain' }), {
			caption: 'first'
		});
		vi.setSystemTime(2000);
		const second = await blobs.put(photos, new Blob(['second']));
		expect(first).toMatch(/^[0-9a-f-]{36}$/);
		expect(second).not.toBe(first);

		const got = await blobs.get(photos, first as string);
		expect(await text(got?.blob)).toBe('one');
		expect(got?.meta).toEqual({ caption: 'first' });

		expect(await blobs.list(photos)).toEqual([
			{ id: second, size: 6, type: '', created: 2000, meta: undefined },
			{ id: first, size: 3, type: 'text/plain', created: 1000, meta: { caption: 'first' } }
		]);

		expect(await blobs.delete(photos, first as string)).toBe(true);
		expect(await blobs.get(photos, first as string)).toBeUndefined();
		expect((await blobs.list(photos)).map((b) => b.id)).toEqual([second]);
	});

	it("refuses meta that fails validate, isn't JSON or is too big", async () => {
		const { blobs, camera, backend } = setup();
		const files = camera.register({ key: 'files', label: 'Files' });
		const blob = new Blob(['x']);
		expect(await blobs.put(blobs.collections()[0]!, blob, { caption: 1 } as never)).toBe(false);
		expect(await blobs.put(files, blob, { n: 1n })).toBe(false);
		const loop: Record<string, unknown> = {};
		loop.self = loop;
		expect(await blobs.put(files, blob, loop)).toBe(false);
		expect(await blobs.put(files, blob, 'x'.repeat(70_000))).toBe(false);
		expect(await blobs.put(files, 'not a blob' as never)).toBe(false);
		expect((backend as ReturnType<typeof memoryBlobs>).rows.size).toBe(0);
		// Without validate, any small JSON is kept, as a copy.
		const meta = { when: new Date(0) };
		const id = await blobs.put(files, blob, meta);
		expect((await blobs.get(files, id as string))?.meta).toEqual({
			when: '1970-01-01T00:00:00.000Z'
		});
	});

	it('reads meta that no longer passes validate as undefined', async () => {
		const { blobs, photos, backend } = setup();
		const id = (await blobs.put(photos, new Blob(['x']), { caption: 'ok' })) as string;
		const row = [...(backend as ReturnType<typeof memoryBlobs>).rows.values()][0]!;
		row.meta = { caption: 5 };
		expect((await blobs.get(photos, id))?.meta).toBeUndefined();
		expect((await blobs.list(photos))[0]?.meta).toBeUndefined();
	});

	it('returns false when storage is full', async () => {
		const backend = memoryBlobs();
		backend.put = () => Promise.reject(new DOMException('full', 'QuotaExceededError'));
		const { blobs, photos } = setup(backend);
		expect(await blobs.put(photos, new Blob(['x']))).toBe(false);
	});

	it('counts usage per collection', async () => {
		const { blobs, camera, photos } = setup();
		const files = camera.register({ key: 'files', label: 'Files' });
		await blobs.put(photos, new Blob(['abc']));
		await blobs.put(photos, new Blob(['de']));
		expect(await blobs.usage()).toEqual([
			{ collection: photos, count: 2, bytes: 5 },
			{ collection: files, count: 0, bytes: 0 }
		]);
	});
});

describe('ids', () => {
	it('are UUIDs outside secure contexts too', async () => {
		const { getRandomValues } = globalThis.crypto;
		vi.stubGlobal('crypto', { getRandomValues: getRandomValues.bind(globalThis.crypto) });
		const { blobs, photos } = setup();
		const id = await blobs.put(photos, new Blob(['x']));
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(await text((await blobs.get(photos, id as string))?.blob)).toBe('x');
	});
});

describe('clear', () => {
	it('does nothing, quietly, for no collections', async () => {
		const { blobs, photos } = setup();
		await blobs.put(photos, new Blob(['x']));
		const heard = vi.fn();
		blobs.onChange(heard);
		expect(await blobs.clear([])).toBe(true);
		expect(heard).not.toHaveBeenCalled();
		expect(await blobs.list(photos)).toHaveLength(1);
	});

	it('clears the given collections, or every one', async () => {
		const { blobs, camera, photos } = setup();
		const notes = blobs.scope('notes').register({ key: 'images', label: 'Images' });
		const files = camera.register({ key: 'files', label: 'Files', group: 'files' });
		for (const c of [photos, notes, files]) await blobs.put(c, new Blob(['x']));

		const heard: (string | null)[] = [];
		blobs.onChange((key) => heard.push(key));
		// "Clear data" for the camera group.
		expect(await blobs.clear(blobs.collections().filter((c) => c.group === 'camera'))).toBe(true);
		expect(await blobs.list(photos)).toEqual([]);
		expect(await blobs.list(notes)).toHaveLength(1);
		expect(await blobs.list(files)).toHaveLength(1);

		await blobs.clear(files);
		expect(await blobs.list(files)).toEqual([]);
		await blobs.clear();
		expect(await blobs.list(notes)).toEqual([]);
		expect(heard).toEqual([photos.key, files.key, null]);
	});
});

describe('when IndexedDB is missing or blocked', () => {
	it('reads as empty and refuses writes', async () => {
		vi.stubGlobal('indexedDB', undefined);
		const { blobs, photos } = setup(indexedDbBlobs('app:blobs'));
		expect(await blobs.put(photos, new Blob(['x']))).toBe(false);
		expect(await blobs.get(photos, 'id')).toBeUndefined();
		expect(await blobs.list(photos)).toEqual([]);
		expect(await blobs.delete(photos, 'id')).toBe(false);
		expect(await blobs.clear()).toBe(false);
		expect(await blobs.usage()).toEqual([{ collection: photos, count: 0, bytes: 0 }]);
	});

	it('closes a database that opens after it was reported blocked', async () => {
		const factory = new IDBFactory();
		const real = factory.open.bind(factory);
		let request: IDBOpenDBRequest | undefined;
		vi.spyOn(factory, 'open').mockImplementation((...args) => (request = real(...args)));
		vi.stubGlobal('indexedDB', factory);
		vi.stubGlobal('IDBKeyRange', IDBKeyRange);
		const { blobs, photos } = setup(indexedDbBlobs('app:blobs'));
		const listing = blobs.list(photos);
		// Report it blocked before it opens.
		request!.onblocked?.(new Event('blocked') as IDBVersionChangeEvent);
		expect(await listing).toEqual([]);
		const close = vi.spyOn(IDBDatabase.prototype, 'close');
		await new Promise<void>((resolve) => request!.addEventListener('success', () => resolve()));
		expect(close).toHaveBeenCalled();
		// The next call opens it again.
		expect(await blobs.put(photos, new Blob(['x']))).toBeTruthy();
	});

	it('reads as empty when opening the database fails', async () => {
		const factory = new IDBFactory();
		vi.spyOn(factory, 'open').mockImplementation(() => {
			throw new DOMException('blocked', 'SecurityError');
		});
		vi.stubGlobal('indexedDB', factory);
		const { blobs, photos } = setup(indexedDbBlobs('app:blobs'));
		expect(await blobs.put(photos, new Blob(['x']))).toBe(false);
		expect(await blobs.list(photos)).toEqual([]);
	});
});

describe('indexedDbBlobs', () => {
	beforeEach(() => {
		vi.stubGlobal('indexedDB', new IDBFactory());
		vi.stubGlobal('IDBKeyRange', IDBKeyRange);
	});

	it("doesn't touch IndexedDB until the first call", () => {
		const open = vi.spyOn(globalThis.indexedDB, 'open');
		setup(indexedDbBlobs('app:blobs'));
		expect(open).not.toHaveBeenCalled();
	});

	it('keeps blobs per collection in one database', async () => {
		const { blobs, camera, photos } = setup(indexedDbBlobs('app:blobs'));
		// A key that is a prefix of another must not catch its blobs.
		const photo = camera.register({ key: 'photo', label: 'Photo' });
		const a = (await blobs.put(photos, new Blob(['a'], { type: 'image/png' }), {
			caption: 'hi'
		})) as string;
		const b = (await blobs.put(photo, new Blob(['bb']))) as string;
		expect(a).toBeTruthy();
		expect(await text((await blobs.get(photos, a))?.blob)).toBe('a');
		expect((await blobs.get(photos, a))?.meta).toEqual({ caption: 'hi' });
		expect(await blobs.list(photos)).toEqual([
			expect.objectContaining({ id: a, size: 1, type: 'image/png', meta: { caption: 'hi' } })
		]);
		expect(await blobs.list(photo)).toEqual([expect.objectContaining({ id: b, size: 2 })]);

		await blobs.clear(photos);
		expect(await blobs.list(photos)).toEqual([]);
		expect(await blobs.list(photo)).toHaveLength(1);
		expect(await blobs.delete(photo, b)).toBe(true);
		expect(await blobs.list(photo)).toEqual([]);

		// Another registry (a reload) on the same database sees what was saved.
		const id = (await blobs.put(photos, new Blob(['kept']))) as string;
		blobs.stop();
		const again = setup(indexedDbBlobs('app:blobs'));
		expect(await text((await again.blobs.get(again.photos, id))?.blob)).toBe('kept');
	});
});

describe('persist', () => {
	it('is never called unless asked', async () => {
		const persist = vi.fn(async () => true);
		const persisted = vi.fn(async () => false);
		vi.stubGlobal('navigator', { storage: { persist, persisted } });
		const { blobs, photos } = setup();
		await blobs.put(photos, new Blob(['x']));
		await blobs.list(photos);
		await blobs.usage();
		expect(persist).not.toHaveBeenCalled();
		expect(await blobs.persisted()).toBe(false);
		expect(await blobs.persist()).toBe('granted');
		expect(persist).toHaveBeenCalledOnce();
	});
});

describe('layer', () => {
	it('wraps the backend', async () => {
		const { blobs, photos, backend } = setup();
		blobs.layer((inner) => ({
			...inner,
			async put(row) {
				await inner.put({ ...row, blob: new Blob([`sealed:${await row.blob.text()}`]) });
			},
			async get(collection, id) {
				const row = await inner.get(collection, id);
				return row && { ...row, blob: new Blob([(await row.blob.text()).slice(7)]) };
			}
		}));
		const id = (await blobs.put(photos, new Blob(['plain']))) as string;
		const stored = [...(backend as ReturnType<typeof memoryBlobs>).rows.values()][0]!;
		expect(await stored.blob.text()).toBe('sealed:plain');
		expect(stored.size).toBe(5);
		expect(await text((await blobs.get(photos, id))?.blob)).toBe('plain');
	});

	it('rejects layers that return no backend', () => {
		const { blobs } = setup();
		expect(() => blobs.layer((() => ({})) as never)).toThrow(/put/);
		expect(() => blobs.layer(1 as never)).toThrow(/function/);
	});

	it('reports a locked layer as empty and unsaved', async () => {
		const { blobs, photos } = setup();
		const locked = () => Promise.reject(new XcwdsError(codes.LOCKED, 'locked'));
		blobs.layer(() => ({ put: locked, get: locked, list: locked, delete: locked, clear: locked }));
		expect(await blobs.put(photos, new Blob(['x']))).toBe(false);
		expect(await blobs.list(photos)).toEqual([]);
	});
});

describe('onChange', () => {
	it('hears other tabs through a BroadcastChannel', async () => {
		const backend = memoryBlobs();
		const one = setup(backend);
		const two = setup(backend);
		const heard = new Promise<string | null>((resolve) => two.blobs.onChange(resolve));
		await one.blobs.put(one.photos, new Blob(['x']));
		expect(await heard).toBe(one.photos.key);
	});
});

describe('app.blobs', () => {
	it("is each plugin's scope, and closes with the app", async () => {
		const backend = { ...memoryBlobs(), close: vi.fn() };
		const app = createApp({ storage: memoryStorage(), blobs: backend, logLevel: 'silent' });
		let id: string | false = false;
		app.register(
			definePlugin(
				async (a) => {
					const photos = a.blobs.register({ key: 'photos', label: 'Photos' });
					id = await a.blobs.put(photos, new Blob(['x']));
				},
				{ name: 'camera' }
			)
		);
		await app.ready();
		expect(app.blobs.collections().map((c) => c.key)).toEqual(['app:camera:photos']);
		expect(id).toBeTruthy();
		expect(() => app.decorate('blobs', 1 as never)).toThrow(/own API/);
		await app.close();
		expect(backend.close).toHaveBeenCalled();
	});

	it('puts collections in the storage groups', () => {
		const blobs = createBlobs({ backend: memoryBlobs() });
		const storage = createStorage({ collections: () => blobs.collections() });
		const text = storage.scope('notes').entry('text', { label: 'Notes', parse: (v) => v });
		const images = blobs
			.scope('notes')
			.register({ key: 'images', label: 'Note images', sensitive: true });
		const photos = blobs.scope('camera').register({ key: 'photos', label: 'Photos' });
		expect(storage.groups()).toEqual([
			{
				id: 'notes',
				label: 'Notes, Note images',
				entries: [text],
				collections: [images],
				sensitive: true
			},
			{ id: 'camera', label: 'Photos', entries: [], collections: [photos], sensitive: false }
		]);
	});
});
