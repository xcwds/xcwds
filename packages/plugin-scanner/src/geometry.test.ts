import { describe, expect, it } from 'vitest';
import {
	PAPER,
	homography,
	isConvex,
	pageSize,
	project,
	rectangle,
	type Quad
} from './geometry.js';

// A page photographed at an angle, in a 4000 × 3000 photo.
const tilted: Quad = [
	{ x: 812, y: 403 },
	{ x: 3104, y: 611 },
	{ x: 3391, y: 2788 },
	{ x: 540, y: 2655 }
];

describe('homography', () => {
	it('maps each corner onto its partner, at pixel scale', () => {
		const target = rectangle(2480, 3508);
		const m = homography(tilted, target)!;
		expect(m[8]).toBe(1);
		tilted.forEach((corner, i) => {
			const p = project(m, corner);
			expect(p.x).toBeCloseTo(target[i]!.x, 6);
			expect(p.y).toBeCloseTo(target[i]!.y, 6);
		});
	});

	it('is the identity between equal quads, and an affine map between parallelograms', () => {
		const id = homography(tilted, tilted)!;
		[1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(id[i]).toBeCloseTo(v, 9));
		const scaled = homography(rectangle(10, 20), rectangle(30, 40))!;
		expect(scaled[6]).toBeCloseTo(0, 12);
		expect(scaled[7]).toBeCloseTo(0, 12);
		expect(project(scaled, { x: 5, y: 10 })).toEqual({ x: 15, y: 20 });
	});

	it('runs both ways: the inverse brings points back', () => {
		const target = rectangle(1000, 1414);
		const there = homography(target, tilted)!;
		const back = homography(tilted, target)!;
		for (const point of [
			{ x: 0, y: 0 },
			{ x: 123, y: 456 },
			{ x: 999, y: 1413 }
		]) {
			const p = project(back, project(there, point));
			expect(p.x).toBeCloseTo(point.x, 6);
			expect(p.y).toBeCloseTo(point.y, 6);
		}
	});

	it('maps straight lines to straight lines (the midpoint of the warped edge stays on it)', () => {
		const m = homography(rectangle(100, 100), tilted)!;
		const mid = project(m, { x: 50, y: 0 });
		const [a, b] = tilted;
		const cross = (b.x - a.x) * (mid.y - a.y) - (b.y - a.y) * (mid.x - a.x);
		expect(Math.abs(cross)).toBeLessThan(1e-6);
	});

	it('refuses quads with three corners on one line or two in the same place', () => {
		const line: Quad = [
			{ x: 0, y: 0 },
			{ x: 50, y: 0 },
			{ x: 100, y: 0 },
			{ x: 0, y: 100 }
		];
		const twice: Quad = [
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			{ x: 100, y: 100 },
			{ x: 0, y: 100 }
		];
		const nan: Quad = [{ x: NaN, y: 0 }, ...rectangle(1, 1).slice(1)] as unknown as Quad;
		for (const bad of [line, twice, nan]) {
			expect(homography(bad, rectangle(10, 10))).toBeNull();
			expect(homography(rectangle(10, 10), bad)).toBeNull();
		}
	});
});

describe('isConvex', () => {
	it('accepts a clockwise page and refuses crossed, reversed and flat ones', () => {
		expect(isConvex(tilted)).toBe(true);
		expect(isConvex(rectangle(10, 10))).toBe(true);
		const [tl, tr, br, bl] = tilted;
		expect(isConvex([tl, br, tr, bl])).toBe(false); // crossed
		expect(isConvex([tl, bl, br, tr])).toBe(false); // anticlockwise
		expect(isConvex([tl, tr, { x: 2000, y: 1000 }, bl])).toBe(false); // dented
		expect(isConvex([tl, tl, br, bl])).toBe(false);
	});
});

describe('pageSize', () => {
	it('keeps the longer of each pair of edges', () => {
		const quad: Quad = [
			{ x: 0, y: 0 },
			{ x: 300, y: 0 },
			{ x: 280, y: 500 },
			{ x: 20, y: 500 }
		];
		expect(pageSize(quad)).toEqual({ width: 300, height: 500, paper: null });
	});

	it('snaps a near-A4 or near-Letter page to the exact shape, keeping the long side', () => {
		expect(pageSize(rectangle(1000, 1400))).toEqual({ width: 990, height: 1400, paper: 'a4' });
		expect(pageSize(rectangle(1400, 1000))).toEqual({ width: 1400, height: 990, paper: 'a4' });
		expect(pageSize(rectangle(850, 1110))).toEqual({ width: 858, height: 1110, paper: 'letter' });
		expect(pageSize(rectangle(1000, 1400), { tolerance: 0 })).toMatchObject({ paper: null });
	});

	it('picks the closer paper when both are within the tolerance', () => {
		const between = rectangle(1000, Math.round(1000 * ((PAPER.a4 + PAPER.letter) / 2 + 0.01)));
		expect(pageSize(between, { tolerance: 0.1 }).paper).toBe('a4');
	});

	it('is at least 1 × 1', () => {
		const dot: Quad = [
			{ x: 5, y: 5 },
			{ x: 5.2, y: 5 },
			{ x: 5.2, y: 5.2 },
			{ x: 5, y: 5.2 }
		];
		expect(pageSize(dot)).toEqual({ width: 1, height: 1, paper: null });
	});
});
