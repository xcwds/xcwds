/**
 * `@xcwds/plugin-scanner/crop`: what the crop screen (`<Crop>`) does between a photo and
 * `app.scanner.scan`: open the photo as pixels, and move the four corner handles by pointer or by
 * arrow key, kept inside the photo. Safe to import during prerender: browser APIs are reached
 * only when a photo is opened.
 */
import { MAX_SIDE, isConvex, type Point, type Quad } from './geometry.js';
import type { Pixels } from './warp.js';

/** The corners' names, in a `Quad`'s order: clockwise from the top left. */
export const CORNERS = ['Top left', 'Top right', 'Bottom right', 'Bottom left'] as const;

export interface Size {
	width: number;
	height: number;
}

/** Where an element sits on screen, as `getBoundingClientRect()` gives it. */
export interface Rect extends Size {
	left: number;
	top: number;
}

/** `point` moved inside a photo of `size`. */
export function clamp(point: Point, size: Size): Point {
	return {
		x: Math.min(Math.max(point.x, 0), size.width),
		y: Math.min(Math.max(point.y, 0), size.height)
	};
}

/** `quad` with the corner at `index` (0 to 3) moved to `point`, kept inside the photo. */
export function moveCorner(quad: Quad, index: number, point: Point, size: Size): Quad {
	if (!(Number.isInteger(index) && index >= 0 && index < 4))
		throw new RangeError('A corner is numbered 0 to 3.');
	const next = [...quad];
	next[index] = clamp(point, size);
	return next as unknown as Quad;
}

/**
 * A point on screen (a pointer's `clientX` and `clientY`) in the photo's pixels, for a photo
 * shown stretched over `rect`.
 */
export function toPhoto(client: Point, rect: Rect, size: Size): Point {
	return clamp(
		{
			x: ((client.x - rect.left) / rect.width) * size.width,
			y: ((client.y - rect.top) / rect.height) * size.height
		},
		size
	);
}

/**
 * How far an arrow key moves a corner, in the photo's pixels: 1% of its shorter side (at least a
 * pixel), or 10% with Shift held.
 */
export function keyStep(size: Size, big = false): number {
	return Math.max(1, Math.round(Math.min(size.width, size.height) / 100)) * (big ? 10 : 1);
}

const ARROWS: Record<string, Point> = {
	ArrowLeft: { x: -1, y: 0 },
	ArrowRight: { x: 1, y: 0 },
	ArrowUp: { x: 0, y: -1 },
	ArrowDown: { x: 0, y: 1 }
};

/**
 * `quad` with the corner at `index` moved one `keyStep` by an arrow key (`event.key`), or `null`
 * for any other key, so the page can leave it alone.
 */
export function nudge(
	quad: Quad,
	index: number,
	key: string,
	size: Size,
	big = false
): Quad | null {
	const arrow = ARROWS[key];
	if (!arrow) return null;
	const step = keyStep(size, big);
	const corner = quad[index];
	if (!corner) throw new RangeError('A corner is numbered 0 to 3.');
	return moveCorner(
		quad,
		index,
		{ x: corner.x + arrow.x * step, y: corner.y + arrow.y * step },
		size
	);
}

export const CROSSED =
	'The corners cross or bunch up, so they don’t make a page. Move each to a corner of the page.';

/** What's wrong with the crop, to show beside it, or `''` when it makes a page. */
export function cropProblem(quad: Quad): string {
	return isConvex(quad) ? '' : CROSSED;
}

export const READ_ERROR = 'This browser couldn’t open the photo.';

export interface ReadOptions {
	/** The longer side to open it at, at most; larger photos are scaled down. Default `MAX_SIDE`. */
	max?: number;
}

/** The browser APIs `readPhoto` uses; the real ones unless a test passes its own. */
export interface ReadEnv {
	createImageBitmap?: (image: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>;
	/** Makes a canvas of the given size to draw the photo on. */
	canvas?: (width: number, height: number) => OffscreenCanvas | HTMLCanvasElement | null;
}

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
	if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
	if (typeof document === 'undefined') return null;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/**
 * A photo (a camera photo's `blob`, or an image file) as upright RGBA pixels for `findPage` and
 * `app.scanner.scan`, scaled down to `max` on its longer side. Resolves with `null` where the
 * browser can't decode it or has no canvas to draw it on. Rejects with a `RangeError` for a bad
 * `max`.
 */
export async function readPhoto(
	photo: Blob,
	options: ReadOptions = {},
	env: ReadEnv = {}
): Promise<Pixels | null> {
	const max = options.max ?? MAX_SIDE;
	if (!(Number.isInteger(max) && max >= 1 && max <= MAX_SIDE))
		throw new RangeError(
			`The largest side must be a whole number of pixels from 1 to ${MAX_SIDE}.`
		);
	const decode =
		env.createImageBitmap ??
		(typeof createImageBitmap === 'function' ? createImageBitmap : undefined);
	if (!decode) return null;
	let bitmap: ImageBitmap;
	try {
		bitmap = await decode(photo, { imageOrientation: 'from-image' });
	} catch {
		return null;
	}
	try {
		const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = (env.canvas ?? makeCanvas)(width, height);
		const context = canvas?.getContext('2d') as Context | null | undefined;
		if (!context) return null;
		context.drawImage(bitmap, 0, 0, width, height);
		const { data } = context.getImageData(0, 0, width, height);
		return { width, height, data };
	} catch {
		// Too big for this browser's canvas, or out of memory.
		return null;
	} finally {
		bitmap.close();
	}
}
