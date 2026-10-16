/**
 * `cleanImage` (#145): turns any image file the browser can open (a photo picked from the
 * device, a share) into a new one made from its pixels only, so no EXIF, GPS, XMP or other
 * metadata survives, upright whatever its EXIF orientation said, and optionally smaller.
 */
import { noMetadata, readMetadata, type ImageMetadata } from './metadata.js';

export type ImageType = 'image/jpeg' | 'image/webp';

export interface CleanOptions {
	/** Scale down so neither side is longer than this many pixels. Default: keep the size. */
	maxSide?: number;
	/** Default `image/jpeg`. A browser that can't write WebP writes PNG instead (see `type`). */
	type?: ImageType;
	/** Encoder quality, 0 to 1. Default 0.92. */
	quality?: number;
}

export type CleanResult =
	| {
			ok: true;
			blob: Blob;
			width: number;
			height: number;
			/** The type the browser actually wrote. */
			type: string;
			/** What the original carried and this copy doesn't. */
			removed: ImageMetadata;
	  }
	| { ok: false; error: string };

const TYPES: readonly string[] = ['image/jpeg', 'image/webp'];

/** `type` when it's one this package writes, else JPEG. */
export const imageType = (type: unknown): ImageType =>
	typeof type === 'string' && TYPES.includes(type) ? (type as ImageType) : 'image/jpeg';

/** `quality` when it's from 0 to 1, else 0.92. */
export const imageQuality = (quality: unknown): number =>
	typeof quality === 'number' && quality >= 0 && quality <= 1 ? quality : 0.92;

/** The size to draw at: the original's, scaled down to fit `maxSide`. */
export function fitSize(
	width: number,
	height: number,
	maxSide?: number
): { width: number; height: number } {
	const scale =
		maxSide !== undefined && Number.isFinite(maxSide) && maxSide >= 1
			? Math.min(1, maxSide / Math.max(width, height))
			: 1;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

type Context = Pick<CanvasRenderingContext2D, 'drawImage' | 'fillRect' | 'fillStyle'>;

/** A region of the source, in its pixels. */
export type Crop = { x: number; y: number; width: number; height: number };

/**
 * Draws `source` (or its `crop` region) at `width`×`height`. JPEG has no transparency, so it gets
 * a white background first: a transparent PNG would otherwise come out black.
 */
function draw(
	context: Context,
	source: CanvasImageSource,
	width: number,
	height: number,
	type: string,
	crop?: Crop
) {
	if (type === 'image/jpeg') {
		context.fillStyle = '#fff';
		context.fillRect(0, 0, width, height);
	}
	if (crop) context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
	else context.drawImage(source, 0, 0, width, height);
}

/**
 * Draws `source` (or its `crop` region) and encodes it, on an `OffscreenCanvas` where there is
 * one. Resolves to null when there's no canvas to draw on.
 */
export async function encode(
	source: CanvasImageSource,
	width: number,
	height: number,
	type: string,
	quality: number,
	crop?: Crop
): Promise<Blob | null> {
	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d');
		if (!context) return null;
		draw(context, source, width, height, type, crop);
		return canvas.convertToBlob({ type, quality });
	}
	if (typeof document === 'undefined') return null;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) return null;
	draw(context, source, width, height, type, crop);
	return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Re-encodes `file` from its pixels. Resolves to an error result, never a rejection, for a file
 * the browser can't decode (HEIC outside Safari, say) or can't re-encode.
 */
export async function cleanImage(file: Blob, options: CleanOptions = {}): Promise<CleanResult> {
	const type = imageType(options.type);
	const quality = imageQuality(options.quality);
	let removed: ImageMetadata;
	try {
		removed = readMetadata(new Uint8Array(await file.arrayBuffer()));
	} catch {
		removed = noMetadata();
	}
	if (typeof createImageBitmap === 'undefined')
		return { ok: false, error: "This browser can't open images here." };
	let bitmap: ImageBitmap;
	try {
		// Applies the EXIF orientation, so the copy is upright without it.
		bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		return {
			ok: false,
			error: "This browser can't open this image. Try a JPEG, PNG or WebP file."
		};
	}
	try {
		const size = fitSize(bitmap.width, bitmap.height, options.maxSide);
		const blob = await encode(bitmap, size.width, size.height, type, quality).catch(() => null);
		if (!blob || blob.size === 0)
			return { ok: false, error: "This image couldn't be saved. It may be too large." };
		return { ok: true, blob, ...size, type: blob.type || type, removed };
	} finally {
		bitmap.close();
	}
}
