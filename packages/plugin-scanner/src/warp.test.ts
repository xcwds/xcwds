import { describe, expect, it } from 'vitest';
import { homography, project, rectangle, type Quad } from './geometry.js';
import { MAX_SIDE, warp, type Pixels } from './warp.js';

function image(width: number, height: number, colour: (x: number, y: number) => number[]): Pixels {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) data.set(colour(x, y), (y * width + x) * 4);
	return { width, height, data };
}

function at(p: Pixels, x: number, y: number): number[] {
	const i = (y * p.width + x) * 4;
	return [...p.data.subarray(i, i + 4)];
}

describe('warp', () => {
	it('copies the image unchanged when the quad is the whole image at its own size', () => {
		const source = image(7, 5, (x, y) => [x * 30, y * 50, (x + y) * 10, 255]);
		const out = warp(source, rectangle(7, 5), { width: 7, height: 5 });
		expect(out.data).toEqual(source.data);
	});

	it('crops a rectangle', () => {
		const source = image(10, 10, (x, y) => [x * 20, y * 20, 0, 255]);
		const out = warp(
			source,
			[
				{ x: 2, y: 3 },
				{ x: 6, y: 3 },
				{ x: 6, y: 8 },
				{ x: 2, y: 8 }
			],
			{ width: 4, height: 5 }
		);
		expect(at(out, 0, 0)).toEqual([40, 60, 0, 255]);
		expect(at(out, 3, 4)).toEqual([100, 140, 0, 255]);
	});

	it('straightens a page drawn in perspective back into its rectangle', () => {
		// A 40 × 56 page with a dark square in its top-left quarter, drawn in perspective onto a
		// grey 100 × 100 photo: each photo pixel looks up where it falls on the page.
		const page = { width: 40, height: 56 };
		const quad: Quad = [
			{ x: 22, y: 12 },
			{ x: 78, y: 18 },
			{ x: 86, y: 90 },
			{ x: 12, y: 82 }
		];
		const toPage = homography(quad, rectangle(page.width, page.height))!;
		const photo = image(100, 100, (x, y) => {
			const p = project(toPage, { x: x + 0.5, y: y + 0.5 });
			if (p.x < 0 || p.y < 0 || p.x > page.width || p.y > page.height) return [128, 128, 128, 255];
			return p.x < 20 && p.y < 28 ? [0, 0, 0, 255] : [255, 255, 255, 255];
		});
		const out = warp(photo, quad, page);
		expect(out).toMatchObject(page);
		// Well inside each region, away from the blurred edges.
		expect(at(out, 8, 10)[0]).toBeLessThan(40);
		expect(at(out, 30, 10)[0]).toBeGreaterThan(215);
		expect(at(out, 8, 45)[0]).toBeGreaterThan(215);
		expect(at(out, 30, 45)[0]).toBeGreaterThan(215);
		// No grey from outside the page on its edges' rows and columns, a pixel in.
		for (let x = 1; x < page.width - 1; x++)
			expect(Math.abs(at(out, x, 1)[0]! - 128)).toBeGreaterThan(40);
	});

	it('takes the nearest edge colour for points outside the image', () => {
		const source = image(4, 4, (x) => (x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		const out = warp(
			source,
			[
				{ x: -10, y: -10 },
				{ x: 14, y: -10 },
				{ x: 14, y: 14 },
				{ x: -10, y: 14 }
			],
			{ width: 4, height: 4 }
		);
		expect(at(out, 0, 0)).toEqual([255, 0, 0, 255]);
		expect(at(out, 3, 3)).toEqual([0, 0, 255, 255]);
	});

	it('refuses bad sizes, mismatched pixels and flat quads', () => {
		const source = image(4, 4, () => [0, 0, 0, 255]);
		const quad = rectangle(4, 4);
		for (const size of [
			{ width: 0, height: 4 },
			{ width: 4, height: 2.5 },
			{ width: MAX_SIDE + 1, height: 4 },
			{ width: NaN, height: 4 }
		])
			expect(() => warp(source, quad, size)).toThrow(RangeError);
		expect(() =>
			warp({ width: 5, height: 4, data: source.data }, quad, { width: 4, height: 4 })
		).toThrow(RangeError);
		const flat: Quad = [
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 4, y: 0 },
			{ x: 0, y: 4 }
		];
		expect(() => warp(source, flat, { width: 4, height: 4 })).toThrow(/one line/);
	});
});
