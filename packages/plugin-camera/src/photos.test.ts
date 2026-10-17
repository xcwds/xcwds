import { createBlobs, memoryBlobs } from '@xcwds/core';
import { buildTestApp } from '@xcwds/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CleanResult } from './clean.js';
import { cameraPlugin } from './client.js';
import { noMetadata } from './metadata.js';
import {
	PHOTO_MESSAGES,
	THUMB_SIDE,
	createPhotos,
	describeRemoved,
	makeThumbnail,
	takenAtOf,
	parsePhotoMeta,
	photoCollections,
	type PhotoEnv
} from './photos.js';

/** A canvas that records its size and writes a 3-byte JPEG. */
function stubCanvas() {
	const sizes: { width: number; height: number }[] = [];
	class Canvas {
		constructor(
			public width: number,
			public height: number
		) {
			sizes.push({ width, height });
		}
		getContext() {
			return { fillStyle: '', fillRect: () => {}, drawImage: () => {} };
		}
		async convertToBlob({ type }: { type: string }) {
			return new Blob([new Uint8Array([1, 2, 3])], { type });
		}
	}
	vi.stubGlobal('OffscreenCanvas', Canvas);
	return sizes;
}

const bitmap = (width: number, height: number) =>
	({ width, height, close: vi.fn() }) as unknown as ImageBitmap;
const env = (width = 4000, height = 3000, now = 1_000): PhotoEnv => ({
	createImageBitmap: vi.fn(async () => bitmap(width, height)),
	now: () => now
});
const jpeg = (text = 'photo') => new Blob([text], { type: 'image/jpeg' });

function store(photoEnv: PhotoEnv = env()) {
	const backend = memoryBlobs();
	const blobs = createBlobs({ backend }).scope('camera');
	const persist = vi.spyOn(blobs, 'persist').mockResolvedValue('granted');
	const photos = createPhotos(blobs, {}, photoEnv);
	/** Rows per collection key. */
	const rows = (key: string) =>
		[...backend.rows.values()].filter((r) => r.collection === key).length;
	return { backend, blobs, persist, collection: photos.collection, photos, rows };
}

afterEach(() => vi.unstubAllGlobals());

describe('photoCollections', () => {
	it('photos and thumbnails: personal, in one group, out of backups', () => {
		const shared = { group: 'photos', sensitive: true, backup: false };
		const { photos, thumbs } = photoCollections();
		expect(photos).toMatchObject({ ...shared, key: 'photos', label: 'Photos' });
		expect(thumbs).toMatchObject({ ...shared, key: 'photos-thumbs', label: 'Photos (thumbnails)' });
		expect(photoCollections({ key: 'notes', label: 'Note photos', group: 'notes' })).toMatchObject({
			photos: { key: 'notes', label: 'Note photos', group: 'notes' },
			thumbs: { key: 'notes-thumbs', label: 'Note photos (thumbnails)', group: 'notes' }
		});
	});

	it('checks a photo’s meta', () => {
		const photo = { width: 4, height: 3, takenAt: 5, thumb: null };
		expect(parsePhotoMeta({ ...photo, extra: 1 })).toEqual(photo);
		expect(parsePhotoMeta({ ...photo, thumb: 'id' })).toEqual({ ...photo, thumb: 'id' });
		expect(parsePhotoMeta({ ...photo, thumb: 4 })).toBeUndefined();
		expect(parsePhotoMeta({ ...photo, width: -1 })).toBeUndefined();
		expect(parsePhotoMeta({ ...photo, takenAt: '5' })).toBeUndefined();
		expect(parsePhotoMeta(null)).toBeUndefined();
	});
});

describe('makeThumbnail', () => {
	it('makes a small JPEG that fits THUMB_SIDE', async () => {
		const sizes = stubCanvas();
		const thumb = await makeThumbnail(jpeg(), env(4000, 3000));
		expect(thumb?.type).toBe('image/jpeg');
		expect(sizes).toEqual([{ width: THUMB_SIDE, height: 240 }]);
	});

	it('is null where the browser can’t decode or draw', async () => {
		stubCanvas();
		const broken = { createImageBitmap: vi.fn(async () => Promise.reject(new Error('HEIC'))) };
		expect(await makeThumbnail(jpeg(), broken)).toBeNull();
		vi.unstubAllGlobals();
		// No canvas at all (Node, here).
		expect(await makeThumbnail(jpeg(), env())).toBeNull();
	});
});

describe('createPhotos', () => {
	it('saves a photo with its thumbnail, and lists photos only, newest first', async () => {
		stubCanvas();
		const { photos, rows, collection } = store();
		const first = await photos.save({ blob: jpeg('a'), width: 4000, height: 3000, takenAt: 10 });
		const second = await photos.save({ blob: jpeg('b'), width: 3000, height: 4000, takenAt: 20 });
		expect(first.ok && second.ok).toBe(true);
		// Each photo has its thumbnail, in a collection of their own.
		expect(rows(collection.key)).toBe(2);
		expect(rows(photos.thumbs.key)).toBe(2);

		const list = await photos.list();
		expect(list.map((p) => p.takenAt)).toEqual([20, 10]);
		expect(list[0]).toMatchObject({ width: 3000, height: 4000, type: 'image/jpeg', size: 1 });
		expect(list[0]!.thumb).toEqual(expect.any(String));
		expect(await (await photos.get(list[0]!.id))?.text()).toBe('b');
		expect((await photos.thumbnail(list[0]!))?.size).toBe(3);
		// A thumbnail's id isn't a photo.
		expect(await photos.get(list[0]!.thumb!)).toBeUndefined();
		expect(await photos.delete(list[0]!.thumb!)).toBe(true);
		expect(rows(photos.thumbs.key)).toBe(2);
	});

	it('uses the clock when the photo has no time, and the photo itself when there’s no thumbnail', async () => {
		const { photos, backend } = store(env(4000, 3000, 1234));
		const saved = await photos.save({ blob: jpeg('a'), width: 4000, height: 3000 });
		expect(saved.ok).toBe(true);
		expect(backend.rows.size).toBe(1);
		const [only] = await photos.list();
		expect(only).toMatchObject({ takenAt: 1234, thumb: null });
		expect(await (await photos.thumbnail(only!))?.text()).toBe('a');
	});

	it('asks to persist storage on the first save only', async () => {
		stubCanvas();
		const { photos, persist } = store();
		await photos.save({ blob: jpeg(), width: 1, height: 1 });
		await photos.save({ blob: jpeg(), width: 1, height: 1 });
		expect(persist).toHaveBeenCalledTimes(1);
	});

	it('a refused or failing persist still saves', async () => {
		stubCanvas();
		const { photos, persist } = store();
		persist.mockRejectedValueOnce(new Error('no'));
		expect((await photos.save({ blob: jpeg(), width: 1, height: 1 })).ok).toBe(true);
	});

	it('full storage: says so and leaves no thumbnail behind', async () => {
		stubCanvas();
		const { photos, blobs, collection, backend } = store();
		const put = blobs.put.bind(blobs);
		vi.spyOn(blobs, 'put').mockImplementation(async (c, blob, meta) =>
			c === collection ? false : put(c, blob, meta)
		);
		const result = await photos.save({ blob: jpeg(), width: 1, height: 1 });
		expect(result).toEqual({ ok: false, error: PHOTO_MESSAGES.full });
		expect(backend.rows.size).toBe(0);
		expect(await blobs.list(collection)).toEqual([]);
	});

	it('deletes a photo and its thumbnail', async () => {
		stubCanvas();
		const { photos, backend } = store();
		const saved = await photos.save({ blob: jpeg(), width: 1, height: 1 });
		if (!saved.ok) throw new Error(saved.error);
		expect(backend.rows.size).toBe(2);
		expect(await photos.delete(saved.id)).toBe(true);
		expect(backend.rows.size).toBe(0);
		expect(await photos.list()).toEqual([]);
		// Already gone counts as deleted.
		expect(await photos.delete(saved.id)).toBe(true);
	});

	it('reports its own saves and deletes, changes to its collection and clears', async () => {
		const { photos, blobs } = store();
		const other = blobs.register({ key: 'other', label: 'Other' });
		const seen = vi.fn();
		const stop = photos.onChange(seen);
		await blobs.clear(other);
		expect(seen).not.toHaveBeenCalled();
		const saved = await photos.save({ blob: jpeg(), width: 1, height: 1 });
		expect(seen).toHaveBeenCalledTimes(1);
		if (!saved.ok) throw new Error(saved.error);
		await photos.delete(saved.id);
		expect(seen).toHaveBeenCalledTimes(2);
		// Nothing to delete: nothing changed.
		await photos.delete(saved.id);
		expect(seen).toHaveBeenCalledTimes(2);
		await blobs.clear(photos.collection);
		await blobs.clear();
		expect(seen).toHaveBeenCalledTimes(4);
		stop();
		await blobs.clear();
		await photos.save({ blob: jpeg(), width: 1, height: 1 });
		expect(seen).toHaveBeenCalledTimes(4);
	});
});

describe('the plugin', () => {
	it('gives the app `app.photos` over `app:camera:photos`, cleared with the Photos group', async () => {
		const app = await buildTestApp({ plugins: [[cameraPlugin(env()), {}]] });
		const shared = { group: 'photos', sensitive: true, backup: false };
		expect(app.photos?.collection).toMatchObject({ ...shared, key: 'app:camera:photos' });
		expect(app.photos?.thumbs).toMatchObject({ ...shared, key: 'app:camera:photos-thumbs' });
		const saved = await app.photos!.save({ blob: jpeg(), width: 1, height: 1 });
		expect(saved.ok).toBe(true);
		expect(await app.photos!.list()).toHaveLength(1);
		await app.blobs.clear();
		expect(await app.photos!.list()).toEqual([]);
		await app.close();
	});
});

describe('add (from files)', () => {
	const cleaned = (removed = {}, extra: Partial<CleanResult> = {}): CleanResult =>
		({
			ok: true,
			blob: jpeg('clean'),
			width: 40,
			height: 30,
			type: 'image/jpeg',
			removed: { ...noMetadata(), ...removed },
			...extra
		}) as CleanResult;

	it('keeps the cleaned copies, dated from the photo, and says what was removed', async () => {
		const clean = vi.fn(async (file: Blob) =>
			(await file.text()) === 'heic'
				? ({ ok: false, error: "Can't open it." } as const)
				: cleaned({ exif: true, gps: true, camera: 'Pixel 8', taken: '2026:10:16 08:12:00' })
		);
		const backend = memoryBlobs();
		const blobs = createBlobs({ backend }).scope('camera');
		vi.spyOn(blobs, 'persist').mockResolvedValue('granted');
		const photos = createPhotos(blobs, { image: { maxSide: 2048 } }, { ...env(), clean });
		const result = await photos.add([
			new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
			new File(['heic'], 'b.heic', { type: 'image/heic' })
		]);
		expect(clean).toHaveBeenCalledWith(expect.any(File), { maxSide: 2048 });
		expect(result.added).toBe(1);
		expect(result.failed).toEqual([{ name: 'b.heic', error: "Can't open it." }]);
		expect(describeRemoved(result.removed)).toBe(
			'Removed the location, the camera (Pixel 8), the date taken and other camera details.'
		);
		const [kept] = await photos.list();
		expect(kept!.takenAt).toBe(new Date(2026, 9, 16, 8, 12, 0).getTime());
		// What's kept is the clean copy, never the picked file.
		expect(await (await photos.get(kept!.id))?.text()).toBe('clean');
	});

	it('dates a file without EXIF by its modified time, and names no camera for several', async () => {
		const cams = ['A', 'B'];
		const clean = vi.fn(async () => cleaned({ exif: true, camera: cams.shift() }));
		const { photos } = store({ ...env(), clean });
		const result = await photos.add([
			new File(['a'], 'a.png', { lastModified: 5000 }),
			new File(['b'], 'b.png', { lastModified: 6000 })
		]);
		expect(result.added).toBe(2);
		expect(result.removed.camera).toBeUndefined();
		expect((await photos.list()).map((p) => p.takenAt)).toEqual([6000, 5000]);
	});

	it('stops at full storage, and never rejects', async () => {
		const clean = vi.fn(async () => cleaned());
		const { photos, blobs } = store({ ...env(), clean });
		vi.spyOn(blobs, 'put').mockResolvedValue(false);
		const result = await photos.add([new File(['a'], 'a.jpg'), new File(['b'], 'b.jpg')]);
		expect(result).toMatchObject({
			added: 0,
			failed: [{ name: 'a.jpg', error: PHOTO_MESSAGES.full }]
		});
		expect(clean).toHaveBeenCalledTimes(1);
		const throwing = store({ ...env(), clean: () => Promise.reject(new Error('boom')) });
		expect((await throwing.photos.add([new File(['a'], 'a.jpg')])).failed).toHaveLength(1);
	});
});

describe('takenAtOf and describeRemoved', () => {
	it('reads an EXIF date as local time, and refuses nonsense', () => {
		expect(takenAtOf('2026:10:16 08:12:00')).toBe(new Date(2026, 9, 16, 8, 12).getTime());
		expect(takenAtOf('2026:13:40 08:12:00')).toBeUndefined();
		expect(takenAtOf('0000:00:00 00:00:00')).toBeUndefined();
		expect(takenAtOf('yesterday')).toBeUndefined();
		expect(takenAtOf(undefined)).toBeUndefined();
	});

	it('says what was removed in plain words', () => {
		expect(describeRemoved(noMetadata())).toBe('No hidden details were found.');
		expect(describeRemoved({ ...noMetadata(), exif: true })).toBe('Removed camera details.');
		expect(describeRemoved({ ...noMetadata(), xmp: true, other: true })).toBe(
			'Removed editing history and embedded text.'
		);
	});
});
