import { describe, expect, it } from 'vitest';
import { applyFilter, greyscale, threshold } from './filters.js';
import type { Pixels } from './warp.js';

function image(width: number, height: number, colour: (x: number, y: number) => number[]): Pixels {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) data.set(colour(x, y), (y * width + x) * 4);
	return { width, height, data };
}

const red = image(2, 1, () => [255, 0, 0, 200]);

describe('greyscale', () => {
	it('weighs the channels by perceived brightness and keeps alpha', () => {
		const out = greyscale(
			image(
				3,
				1,
				(x) =>
					[
						[255, 0, 0, 200],
						[0, 255, 0, 255],
						[0, 0, 255, 0]
					][x]!
			)
		);
		expect([...out.data]).toEqual([76, 76, 76, 200, 150, 150, 150, 255, 29, 29, 29, 0]);
	});
});

describe('threshold', () => {
	// Dark text strokes on paper lit from the left: the right side, in shadow, is darker than the
	// ink on the left side, so a single global threshold can't separate both.
	const width = 120;
	const height = 40;
	const ink = (x: number, y: number) => y >= 15 && y < 25 && x % 20 >= 8 && x % 20 < 11;
	const page = image(width, height, (x, y) => {
		const light = 240 - x * 1.5; // 240 on the left, 60 on the right
		const v = ink(x, y) ? light * 0.4 : light;
		return [v, v, v, 255];
	});

	it('finds the ink on both the lit and the shaded side', () => {
		const out = threshold(page, { radius: 8 });
		let wrong = 0;
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				const black = out.data[(y * width + x) * 4] === 0;
				if (black !== ink(x, y)) wrong++;
			}
		expect(wrong).toBe(0);
		expect(page.data[(20 * width + 8) * 4]).toBeGreaterThan(page.data[(5 * width + 110) * 4]!);
	});

	it('leaves plain paper white, opaque and black or white only', () => {
		const out = threshold(image(30, 30, () => [180, 170, 160, 100]));
		expect(new Set(out.data)).toEqual(new Set([255]));
		const mixed = threshold(page);
		expect(new Set(mixed.data)).toEqual(new Set([0, 255]));
	});

	it('refuses an offset outside 0 to 1 and a radius that isn’t above 0', () => {
		for (const offset of [-0.1, 1, NaN])
			expect(() => threshold(red, { offset })).toThrow(RangeError);
		for (const radius of [0, -3, NaN, Infinity])
			expect(() => threshold(red, { radius })).toThrow(RangeError);
	});
});

describe('applyFilter', () => {
	it('runs the named filter, and Original returns a copy', () => {
		expect(applyFilter(red, 'greyscale')).toEqual(greyscale(red));
		expect(applyFilter(red, 'bw')).toEqual(threshold(red));
		const copy = applyFilter(red, 'original');
		expect(copy).toEqual(red);
		expect(copy.data).not.toBe(red.data);
	});
});
