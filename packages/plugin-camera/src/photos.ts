/**
 * Photos kept in the app (#146): saved to a blob collection (`app.blobs`, #144) with a small
 * thumbnail beside each, so a grid can list them without decoding full photos. Framework-agnostic
 * and safe to import during prerender: browser APIs are reached only when a method is called.
 *
 * Thumbnails have a collection of their own in the same group (so Settings counts photos as
 * photos, and clearing the group clears both): each is saved first, and its photo's `meta` names
 * it.
 */
import type { BlobInfo, BlobScope, Collection } from '@xcwds/core';
import { encode, fitSize } from './clean.js';

/** What a photo's blob carries in `meta`. */
export interface PhotoMeta {
	width: number;
	height: number;
	/** When it was taken, in ms since the epoch. */
	takenAt: number;
	/** The thumbnail's blob id, or null when one couldn't be made. */
	thumb: string | null;
}

/** A saved photo, without its contents. */
export interface SavedPhoto {
	id: string;
	width: number;
	height: number;
	takenAt: number;
	/** Bytes, the photo only. */
	size: number;
	type: string;
	thumb: string | null;
}

export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

/** What `save` needs: a `Photo` from the camera, or any image with its size. */
export interface PhotoInput {
	blob: Blob;
	width: number;
	height: number;
	takenAt?: number;
}

/** Longest side of a thumbnail, in pixels. */
export const THUMB_SIDE = 320;

export const PHOTO_MESSAGES = {
	full: "The photo couldn't be saved: this device's storage is full or blocked. It's still on screen.",
	missing: 'That photo is no longer here.'
} as const;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Checks a photo's `meta` (the photos collection's `validate`). */
export function parsePhotoMeta(raw: unknown): PhotoMeta | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const m = raw as Record<string, unknown>;
	if (!isCount(m.width) || !isCount(m.height) || !isCount(m.takenAt)) return undefined;
	if (m.thumb !== null && typeof m.thumb !== 'string') return undefined;
	return { width: m.width, height: m.height, takenAt: m.takenAt, thumb: m.thumb };
}

/** Thumbnails carry no `meta`. */
export interface PhotoCollectionOptions {
	/** Default `photos`; the thumbnails' collection is `<key>-thumbs`. */
	key?: string;
	/** Default `Photos`; the thumbnails' is `<label> (thumbnails)`. */
	label?: string;
	/** Default `photos`. Clearing the group clears both. */
	group?: string;
}

/**
 * The options for a photos collection and its thumbnails', to pass to `app.blobs.register`: both
 * personal (`sensitive`), in one group, out of backups.
 */
export function photoCollections(options: PhotoCollectionOptions = {}) {
	const key = options.key ?? 'photos';
	const label = options.label ?? 'Photos';
	const group = options.group ?? 'photos';
	const shared = { group, sensitive: true, backup: false } as const;
	return {
		photos: { ...shared, key, label, validate: parsePhotoMeta },
		thumbs: { ...shared, key: `${key}-thumbs`, label: `${label} (thumbnails)` }
	};
}

/** What the store uses of `app.blobs`. */
export type BlobsLike = Pick<
	BlobScope,
	'register' | 'put' | 'get' | 'list' | 'delete' | 'onChange' | 'persist'
>;

export interface PhotoEnv {
	createImageBitmap?: (source: ImageBitmapSource) => Promise<ImageBitmap>;
	now?: () => number;
}

export interface Photos {
	readonly collection: Collection<PhotoMeta>;
	readonly thumbs: Collection;
	/**
	 * Keeps a photo. The first one this session also asks the browser not to evict the app's data
	 * (`persist`): Firefox asks the person, so it follows the shutter tap; a refusal changes nothing.
	 */
	save(photo: PhotoInput): Promise<SaveResult>;
	/** The photos, newest first. */
	list(): Promise<SavedPhoto[]>;
	/** A photo's file. */
	get(id: string): Promise<Blob | undefined>;
	/** Its thumbnail, or the photo itself when it has none. */
	thumbnail(photo: SavedPhoto): Promise<Blob | undefined>;
	/** Deletes a photo and its thumbnail. False if it couldn't. */
	delete(id: string): Promise<boolean>;
	/** Calls `listener` when the photos change in another tab, or are cleared. */
	onChange(listener: () => void): () => void;
}

/** Makes a small JPEG of `blob`, or null when the browser can't. */
export async function makeThumbnail(blob: Blob, env: PhotoEnv = {}): Promise<Blob | null> {
	let bitmap: ImageBitmap | undefined;
	try {
		bitmap = await (env.createImageBitmap ?? createImageBitmap)(blob);
		const size = fitSize(bitmap.width, bitmap.height, THUMB_SIDE);
		const thumb = await encode(bitmap, size.width, size.height, 'image/jpeg', 0.8);
		return thumb && thumb.size > 0 ? thumb : null;
	} catch {
		return null;
	} finally {
		bitmap?.close();
	}
}

/**
 * A photo store over `blobs` (an `app.blobs`): registers the collections `photoCollections(options)`
 * describes, so call it once per key, as the plugin is set up.
 */
export function createPhotos(
	blobs: BlobsLike,
	options: PhotoCollectionOptions = {},
	env: PhotoEnv = {}
): Photos {
	const described = photoCollections(options);
	const collection = blobs.register(described.photos);
	const thumbs = blobs.register(described.thumbs);
	let persisted = false;
	const now = () => (env.now ?? Date.now)();

	const toSaved = (info: BlobInfo<PhotoMeta>): SavedPhoto | null => {
		const m = info.meta;
		// A photo whose meta no longer passes is unlisted rather than shown wrong.
		if (!m) return null;
		return {
			id: info.id,
			width: m.width,
			height: m.height,
			takenAt: m.takenAt,
			size: info.size,
			type: info.type,
			thumb: m.thumb
		};
	};

	return {
		collection,
		thumbs,
		async save(photo) {
			// The thumbnail first, so a photo never names one that isn't there. Without one, the grid
			// shows the photo itself.
			const small = await makeThumbnail(photo.blob, env);
			const thumb = small ? await blobs.put(thumbs, small) : false;
			const id = await blobs.put(collection, photo.blob, {
				width: photo.width,
				height: photo.height,
				takenAt: photo.takenAt ?? now(),
				thumb: thumb || null
			});
			if (!id) {
				if (thumb) await blobs.delete(thumbs, thumb);
				return { ok: false, error: PHOTO_MESSAGES.full };
			}
			if (!persisted) {
				persisted = true;
				await blobs.persist().catch(() => 'denied');
			}
			return { ok: true, id };
		},
		async list() {
			const all = await blobs.list(collection);
			return all
				.map(toSaved)
				.filter((p): p is SavedPhoto => p !== null)
				.sort((a, b) => b.takenAt - a.takenAt);
		},
		async get(id) {
			return (await blobs.get(collection, id))?.blob;
		},
		async thumbnail(photo) {
			if (photo.thumb) {
				const small = await blobs.get(thumbs, photo.thumb);
				if (small) return small.blob;
			}
			return this.get(photo.id);
		},
		async delete(id) {
			const found = await blobs.get(collection, id);
			if (!(await blobs.delete(collection, id))) return false;
			// A thumbnail left behind is only wasted space: the photo is gone either way.
			const thumb = found?.meta?.thumb;
			if (thumb) await blobs.delete(thumbs, thumb);
			return true;
		},
		onChange(listener) {
			return blobs.onChange((key) => {
				if (key === null || key === collection.key) listener();
			});
		}
	};
}
