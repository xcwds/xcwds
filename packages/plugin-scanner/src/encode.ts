/**
 * `@xcwds/plugin-scanner/encode`: a finished page as the JPEG that the pages store keeps and the
 * PDF takes as it is. Encoded on an `OffscreenCanvas` (in the processing Worker, or on the page),
 * else on a `<canvas>`. Safe to import during prerender: browser APIs are reached only when a page
 * is encoded.
 */
import type { Pixels } from './warp.js';

/** The default JPEG quality: text stays sharp, and a page is a few hundred KB. */
export const JPEG_QUALITY = 0.9;

export interface EncodeOptions {
	/** From 0 to 1. Default `JPEG_QUALITY`. */
	quality?: number;
}

export const ENCODE_ERROR = 'This browser couldn’t make a JPEG of the page.';

/** The quality to encode at; throws a `RangeError` for one that isn't a number from 0 to 1. */
export function jpegQuality(quality: number = JPEG_QUALITY): number {
	if (typeof quality !== 'number' || !(quality >= 0 && quality <= 1))
		throw new RangeError('The JPEG quality must be a number from 0 to 1.');
	return quality;
}

/**
 * `page` on white where any of it is see-through, since JPEG has no transparency and a canvas
 * would encode those pixels black. An opaque page (a photo's always is) comes back as it is.
 */
export function onWhite(page: Pixels): Pixels {
	const { data } = page;
	let i = 3;
	while (i < data.length && data[i] === 255) i += 4;
	if (i >= data.length) return page;
	const out = new Uint8ClampedArray(data.length);
	for (let p = 0; p < data.length; p += 4) {
		const a = data[p + 3]! / 255;
		for (let k = 0; k < 3; k++) out[p + k] = data[p + k]! * a + 255 * (1 - a);
		out[p + 3] = 255;
	}
	return { width: page.width, height: page.height, data: out };
}

type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/**
 * `page` as a JPEG `Blob`, or null where there's no canvas to encode it on or the browser made
 * something else (a canvas that can't encode a type falls back to PNG). Throws a `RangeError`
 * for a bad `quality` or pixels that don't match their size.
 */
export async function encodeJpeg(page: Pixels, options: EncodeOptions = {}): Promise<Blob | null> {
	const quality = jpegQuality(options.quality);
	const { width, height } = page;
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width < 1 ||
		height < 1 ||
		!(page.data instanceof Uint8ClampedArray) ||
		page.data.length !== width * height * 4
	)
		throw new RangeError('The page’s pixels don’t match its width and height.');
	if (typeof ImageData === 'undefined') return null;
	const pixels = onWhite(page);
	try {
		const image = new ImageData(pixels.data as Uint8ClampedArray<ArrayBuffer>, width, height);
		let blob: Blob | null;
		if (typeof OffscreenCanvas !== 'undefined') {
			const canvas = new OffscreenCanvas(width, height);
			const context: Context | null = canvas.getContext('2d');
			if (!context) return null;
			context.putImageData(image, 0, 0);
			blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
		} else {
			if (typeof document === 'undefined') return null;
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const context: Context | null = canvas.getContext('2d');
			if (!context) return null;
			context.putImageData(image, 0, 0);
			blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, 'image/jpeg', quality)
			);
		}
		return blob?.type === 'image/jpeg' ? blob : null;
	} catch {
		// Too big for this browser's canvas, or out of memory.
		return null;
	}
}
