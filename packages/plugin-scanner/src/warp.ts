/**
 * `@xcwds/plugin-scanner/warp`: straighten a photographed page into a rectangle. This is the plain
 * JavaScript path, which works anywhere (a Worker, a browser without WebGL, Node in tests);
 * `./warp-gl` does the same on the GPU where it can. Pure functions, safe to import anywhere.
 */
import { MAX_SIDE, homography, rectangle, type Matrix, type Quad } from './geometry.js';

export { MAX_SIDE };

/** RGBA pixels, row by row: the shape of `ImageData`, which can be passed as is. */
export interface Pixels {
	width: number;
	height: number;
	data: Uint8ClampedArray;
}

/**
 * The checks `warp` makes, and the homography it samples with: from a point of the
 * `width` × `height` output to the point of `source` it shows. Throws as `warp` does.
 */
export function warpMatrix(
	source: Pixels,
	quad: Quad,
	size: { width: number; height: number }
): Matrix {
	const { width, height } = size;
	for (const side of [width, height])
		if (!Number.isInteger(side) || side < 1 || side > MAX_SIDE)
			throw new RangeError(`The output must be 1 to ${MAX_SIDE} pixels on each side.`);
	if (
		!Number.isInteger(source.width) ||
		!Number.isInteger(source.height) ||
		source.width < 1 ||
		source.height < 1 ||
		source.data.length !== source.width * source.height * 4
	)
		throw new RangeError('The source pixels don’t match its width and height.');
	const m = homography(rectangle(width, height), quad);
	if (!m) throw new RangeError('The corners don’t make a page: three of them are on one line.');
	return m;
}

/**
 * The part of `source` inside `quad` (corners clockwise from the top left, in `source`'s pixels),
 * stretched onto a `width` × `height` rectangle with bilinear sampling. Points of the quad outside
 * the image take the colour of its nearest edge. Throws a `RangeError` for a size that isn't a
 * whole number from 1 to `MAX_SIDE`, a source without pixels, or a quad with three corners on one
 * line.
 */
export function warp(source: Pixels, quad: Quad, size: { width: number; height: number }): Pixels {
	const m = warpMatrix(source, quad, size);
	const { width, height } = size;
	const out = new Uint8ClampedArray(width * height * 4);
	const src = source.data;
	const maxX = source.width - 1;
	const maxY = source.height - 1;
	let o = 0;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			// Pixel centres on both sides, so a quad equal to the image copies it unchanged. This is
			// `project` written out, since it runs for every pixel.
			const cx = x + 0.5;
			const cy = y + 0.5;
			const w = m[6] * cx + m[7] * cy + m[8];
			const px = (m[0] * cx + m[1] * cy + m[2]) / w;
			const py = (m[3] * cx + m[4] * cy + m[5]) / w;
			const sx = Math.min(Math.max(px - 0.5, 0), maxX);
			const sy = Math.min(Math.max(py - 0.5, 0), maxY);
			const x0 = Math.floor(sx);
			const y0 = Math.floor(sy);
			const x1 = Math.min(x0 + 1, maxX);
			const y1 = Math.min(y0 + 1, maxY);
			const fx = sx - x0;
			const fy = sy - y0;
			const a = (y0 * source.width + x0) * 4;
			const b = (y0 * source.width + x1) * 4;
			const c = (y1 * source.width + x0) * 4;
			const d = (y1 * source.width + x1) * 4;
			for (let k = 0; k < 4; k++) {
				const top = src[a + k]! + (src[b + k]! - src[a + k]!) * fx;
				const bottom = src[c + k]! + (src[d + k]! - src[c + k]!) * fx;
				out[o++] = top + (bottom - top) * fy;
			}
		}
	}
	return { width, height, data: out };
}
