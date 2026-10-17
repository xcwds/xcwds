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
import { cleanImage, encode, fitSize, type CleanOptions } from './clean.js';
import { noMetadata, type ImageMetadata } from './metadata.js';

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
	/** How `add` re-encodes picked files (the camera plugin passes its own options). */
	image?: CleanOptions;
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
	/** Stands in for `cleanImage` in tests. */
	clean?: typeof cleanImage;
}

/** What `add` did with the files it was given. */
export interface AddResult {
	/** How many were kept. */
	added: number;
	/** The ones that weren't, with why. */
	failed: { name: string; error: string }[];
	/** What the kept files carried that their copies don't (all of them together). */
	removed: ImageMetadata;
}

export interface Photos {
	readonly collection: Collection<PhotoMeta>;
	readonly thumbs: Collection;
	/**
	 * Keeps a photo. The first one this session also asks the browser not to evict the app's data
	 * (`persist`): Firefox asks the person, so it follows the shutter tap; a refusal changes nothing.
	 */
	save(photo: PhotoInput): Promise<SaveResult>;
	/**
	 * Keeps picked image files ("Add from files"): each is re-encoded from its pixels
	 * (`cleanImage`), so nothing it carried (location, camera, dates) is kept. Never rejects.
	 */
	add(files: Iterable<File>): Promise<AddResult>;
	/** The photos, newest first. */
	list(): Promise<SavedPhoto[]>;
	/** A photo's file. */
	get(id: string): Promise<Blob | undefined>;
	/** Its thumbnail, or the photo itself when it has none. */
	thumbnail(photo: SavedPhoto): Promise<Blob | undefined>;
	/** Deletes a photo and its thumbnail. False if it couldn't. */
	delete(id: string): Promise<boolean>;
	/** Calls `listener` when the photos change: saved or deleted here or in another tab, or cleared. */
	onChange(listener: () => void): () => void;
}

/**
 * When an EXIF date (`2026:10:16 08:12:00`, local time with no zone) was, in ms since the epoch,
 * read as this device's local time. Undefined when there's none or it doesn't parse.
 */
export function takenAtOf(taken: string | undefined): number | undefined {
	const m = taken?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
	if (!m) return undefined;
	const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [
		number,
		number,
		number,
		number,
		number,
		number
	];
	const date = new Date(y, mo - 1, d, h, mi, se);
	// `new Date` rolls an impossible date over (month 13, say); refuse it instead.
	if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d)
		return undefined;
	return date.getTime();
}

const join = (items: string[]) =>
	items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** A sentence for what cleaning removed: `Removed the location, the camera (Google Pixel 8) and…`. */
export function describeRemoved(removed: ImageMetadata): string {
	const parts: string[] = [];
	if (removed.gps) parts.push('the location');
	if (removed.camera) parts.push(`the camera (${removed.camera})`);
	if (removed.taken) parts.push('the date taken');
	if (removed.exif && !removed.camera && !removed.taken && !removed.gps)
		parts.push('camera details');
	else if (removed.exif) parts.push('other camera details');
	if (removed.xmp) parts.push('editing history');
	if (removed.other) parts.push('embedded text');
	return parts.length ? `Removed ${join(parts)}.` : 'No hidden details were found.';
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
	/** This tab's own saves and deletes; `app.blobs` reports other tabs' and clears. */
	const local = new Set<() => void>();
	const changed = () => {
		for (const listener of [...local]) listener();
	};
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

	const photos: Photos = {
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
			changed();
			if (!persisted) {
				persisted = true;
				await blobs.persist().catch(() => 'denied');
			}
			return { ok: true, id };
		},
		async add(files) {
			const result: AddResult = { added: 0, failed: [], removed: noMetadata() };
			const cameras = new Set<string>();
			for (const file of files) {
				const cleaned = await (env.clean ?? cleanImage)(file, options.image).catch(() => ({
					ok: false as const,
					error: "This browser can't open this image. Try a JPEG, PNG or WebP file."
				}));
				if (!cleaned.ok) {
					result.failed.push({ name: file.name, error: cleaned.error });
					continue;
				}
				const saved = await photos.save({
					blob: cleaned.blob,
					width: cleaned.width,
					height: cleaned.height,
					takenAt: takenAtOf(cleaned.removed.taken) ?? (file.lastModified || undefined)
				});
				if (!saved.ok) {
					result.failed.push({ name: file.name, error: saved.error });
					// Storage is full: the rest won't fit either.
					break;
				}
				result.added++;
				const r = cleaned.removed;
				result.removed.exif ||= r.exif;
				result.removed.gps ||= r.gps;
				result.removed.xmp ||= r.xmp;
				result.removed.other ||= r.other;
				if (r.taken) result.removed.taken ??= r.taken;
				if (r.camera) cameras.add(r.camera);
			}
			// One camera's name says something; several are just "camera details".
			if (cameras.size === 1) result.removed.camera = [...cameras][0];
			else if (cameras.size > 1) result.removed.exif = true;
			return result;
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
			if (found) changed();
			// A thumbnail left behind is only wasted space: the photo is gone either way.
			const thumb = found?.meta?.thumb;
			if (thumb) await blobs.delete(thumbs, thumb);
			return true;
		},
		onChange(listener) {
			local.add(listener);
			const stop = blobs.onChange((key) => {
				if (key === null || key === collection.key) listener();
			});
			return () => {
				local.delete(listener);
				stop();
			};
		}
	};
	return photos;
}
