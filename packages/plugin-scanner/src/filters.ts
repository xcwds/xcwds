/**
 * `@xcwds/plugin-scanner/filters`: make a straightened page easier to read. Original keeps the
 * photo, Greyscale drops the colour, and Black & white turns it into ink on paper with an adaptive
 * threshold, which copes with shadows and uneven light across the page. Pure functions on RGBA
 * pixels, safe to import anywhere (the plugin runs them in a Worker).
 */
import type { Pixels } from './warp.js';

export const FILTERS = ['original', 'greyscale', 'bw'] as const;

export type Filter = (typeof FILTERS)[number];

export interface ThresholdOptions {
	/**
	 * Half the side of the square each pixel is compared with, in pixels. By default a sixteenth
	 * of the page's shorter side (at least 4), wider than a letter's strokes.
	 */
	radius?: number;
	/** How much darker than its surroundings a pixel must be to count as ink: 0.15 is 15%. */
	offset?: number;
}

/** `pixels` through `filter`, as new pixels (Original returns a copy). */
export function applyFilter(pixels: Pixels, filter: Filter): Pixels {
	if (filter === 'greyscale') return greyscale(pixels);
	if (filter === 'bw') return threshold(pixels);
	return { width: pixels.width, height: pixels.height, data: pixels.data.slice() };
}

/** `pixels` in shades of grey, by perceived brightness (ITU-R BT.601), alpha kept. */
export function greyscale(pixels: Pixels): Pixels {
	const { data } = pixels;
	const out = new Uint8ClampedArray(data.length);
	for (let i = 0; i < data.length; i += 4) {
		const y = luma(data, i);
		out[i] = out[i + 1] = out[i + 2] = y;
		out[i + 3] = data[i + 3]!;
	}
	return { width: pixels.width, height: pixels.height, data: out };
}

/**
 * `pixels` in black and white: a pixel is black when it's `offset` darker than the average of
 * the square around it (Bradley and Roth's adaptive threshold, with a summed-area table so each
 * pixel costs the same whatever the radius). Fully opaque.
 */
export function threshold(pixels: Pixels, options: ThresholdOptions = {}): Pixels {
	const { width, height, data } = pixels;
	const radius = Math.max(
		1,
		Math.round(options.radius ?? Math.max(4, Math.min(width, height) / 16))
	);
	const offset = options.offset ?? 0.15;
	if (!(offset >= 0 && offset < 1)) throw new RangeError('The offset must be from 0 up to 1.');
	// sums[(y + 1) * (width + 1) + (x + 1)] is the sum of the luma above and left of (x, y), included.
	const stride = width + 1;
	const sums = new Float64Array(stride * (height + 1));
	for (let y = 0; y < height; y++) {
		let row = 0;
		for (let x = 0; x < width; x++) {
			row += luma(data, (y * width + x) * 4);
			sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1]! + row;
		}
	}
	const out = new Uint8ClampedArray(data.length);
	for (let y = 0; y < height; y++) {
		const top = Math.max(0, y - radius);
		const bottom = Math.min(height, y + radius + 1);
		for (let x = 0; x < width; x++) {
			const left = Math.max(0, x - radius);
			const right = Math.min(width, x + radius + 1);
			const area = (bottom - top) * (right - left);
			const sum =
				sums[bottom * stride + right]! -
				sums[top * stride + right]! -
				sums[bottom * stride + left]! +
				sums[top * stride + left]!;
			const i = (y * width + x) * 4;
			const v = luma(data, i) * area < sum * (1 - offset) ? 0 : 255;
			out[i] = out[i + 1] = out[i + 2] = v;
			out[i + 3] = 255;
		}
	}
	return { width, height, data: out };
}

function luma(data: Uint8ClampedArray, i: number): number {
	return (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
}
