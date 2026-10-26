import { describe, expect, it } from 'vitest';
import { findPage, startCorners } from './corners.js';
import { homography, isConvex, project, rectangle, type Quad } from './geometry.js';
import type { Pixels } from './warp.js';

/** A seeded random number generator (mulberry32), so every fixture is the same on every run. */
function random(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface Scene {
	width: number;
	height: number;
	/** The page's corners in the photo, or none for a photo of the desk alone. */
	page?: Quad;
	/** The desk's colour, before its grain. */
	desk?: [number, number, number];
	/** The paper's colour, before the light. */
	paper?: [number, number, number];
	/** How much light falls at `x` on the photo, from 0 to 1 (1 everywhere by default). */
	light?: (x: number, y: number) => number;
	/** Camera noise, in grey levels either way. */
	noise?: number;
	/** One look-up per pixel instead of four, for big photos, whose edges are sharp anyway. */
	sharp?: boolean;
	seed?: number;
}

/**
 * A fixture photo: a sheet of A4 with lines of text, drawn in perspective onto a wooden desk,
 * with camera noise. Each photo pixel looks up where it falls on the page, at four points inside
 * it (unless `sharp`) so the page's edges are smooth as a camera's would be.
 */
function photo(scene: Scene): Pixels {
	const { width, height, page } = scene;
	const desk = scene.desk ?? [128, 86, 52];
	const paper = scene.paper ?? [238, 235, 228];
	const light = scene.light ?? (() => 1);
	const noise = scene.noise ?? 10;
	const rand = random(scene.seed ?? 1);
	const samples = scene.sharp
		? ([[0.5, 0.5]] as const)
		: ([
				[0.25, 0.25],
				[0.75, 0.25],
				[0.25, 0.75],
				[0.75, 0.75]
			] as const);
	const sheet = { width: 210, height: 297 };
	const toSheet = page ? homography(page, rectangle(sheet.width, sheet.height))! : undefined;
	const ink = (u: number, v: number) => {
		if (u < 20 || u > 190 || v < 25 || v > 270) return false;
		const line = (v - 25) % 12;
		const word = (u - 20 + Math.floor((v - 25) / 12) * 17) % 37;
		return line < 4 && word < 30;
	};
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			let r = 0;
			let g = 0;
			let b = 0;
			for (const [ox, oy] of samples) {
				const px = x + ox;
				const py = y + oy;
				const s = toSheet && project(toSheet, { x: px, y: py });
				let c: readonly number[];
				if (s && s.x >= 0 && s.y >= 0 && s.x <= sheet.width && s.y <= sheet.height)
					c = ink(s.x, s.y) ? [40, 40, 50] : paper;
				else {
					const grain = 0.85 + 0.15 * Math.sin(py / 7 + Math.sin(px / 40) * 3);
					c = desk.map((v) => v * grain);
				}
				const l = light(px, py);
				r += c[0]! * l;
				g += c[1]! * l;
				b += c[2]! * l;
			}
			const n = (rand() * 2 - 1) * noise;
			const k = samples.length;
			data.set([r / k + n, g / k + n, b / k + n, 255], (y * width + x) * 4);
		}
	return { width, height, data };
}

/** The furthest any corner of `found` is from the same corner of `truth`, in pixels. */
function error(found: Quad, truth: Quad): number {
	return Math.max(...found.map((p, i) => Math.hypot(p.x - truth[i]!.x, p.y - truth[i]!.y)));
}

describe('findPage', () => {
	it('finds a page lying on a desk', () => {
		const page: Quad = [
			{ x: 170, y: 60 },
			{ x: 462, y: 52 },
			{ x: 470, y: 440 },
			{ x: 164, y: 446 }
		];
		const quad = findPage(photo({ width: 640, height: 480, page }));
		expect(quad).not.toBeNull();
		expect(isConvex(quad!)).toBe(true);
		// Within 1% of the photo's diagonal (8 px of 800).
		expect(error(quad!, page)).toBeLessThan(8);
	});

	it('finds a page photographed at an angle', () => {
		const page: Quad = [
			{ x: 250, y: 70 },
			{ x: 540, y: 160 },
			{ x: 430, y: 450 },
			{ x: 90, y: 330 }
		];
		const quad = findPage(photo({ width: 640, height: 480, page, seed: 2 }));
		expect(quad).not.toBeNull();
		expect(error(quad!, page)).toBeLessThan(8);
	});

	it('finds a page in strong perspective, its far edge much shorter', () => {
		const page: Quad = [
			{ x: 230, y: 90 },
			{ x: 410, y: 90 },
			{ x: 560, y: 450 },
			{ x: 80, y: 450 }
		];
		const quad = findPage(photo({ width: 640, height: 480, page, seed: 3 }));
		expect(quad).not.toBeNull();
		expect(error(quad!, page)).toBeLessThan(8);
	});

	it('finds a page with a shadow across it', () => {
		const page: Quad = [
			{ x: 140, y: 40 },
			{ x: 480, y: 60 },
			{ x: 470, y: 450 },
			{ x: 130, y: 430 }
		];
		// The right half in the shade of a phone held over it: the page there is darker than in the
		// light, but still brighter than the desk.
		const light = (x: number) => (x < 300 ? 1 : x > 340 ? 0.7 : 1 - ((x - 300) / 40) * 0.3);
		const quad = findPage(photo({ width: 640, height: 480, page, light, seed: 4 }));
		expect(quad).not.toBeNull();
		expect(error(quad!, page)).toBeLessThan(8);
	});

	it('finds a page in a noisy photo taken in dim light', () => {
		const page: Quad = [
			{ x: 170, y: 60 },
			{ x: 462, y: 52 },
			{ x: 470, y: 440 },
			{ x: 164, y: 446 }
		];
		const quad = findPage(
			photo({ width: 640, height: 480, page, light: () => 0.6, noise: 40, seed: 13 })
		);
		expect(quad).not.toBeNull();
		expect(error(quad!, page)).toBeLessThan(8);
	});

	it('finds a page in a full-size photo, with the corners in its pixels', () => {
		const page: Quad = [
			{ x: 700, y: 260 },
			{ x: 2300, y: 330 },
			{ x: 2240, y: 2700 },
			{ x: 620, y: 2600 }
		];
		const quad = findPage(photo({ width: 3000, height: 3000, page, seed: 5, sharp: true }));
		expect(quad).not.toBeNull();
		// Within 1% of the diagonal (42 px of 4243): a starting point the crop screen refines.
		expect(error(quad!, page)).toBeLessThan(42);
	});

	it('finds a page in a portrait photo whose sides the frame doesn’t divide evenly', () => {
		const page: Quad = [
			{ x: 80, y: 150 },
			{ x: 420, y: 130 },
			{ x: 440, y: 620 },
			{ x: 70, y: 640 }
		];
		const quad = findPage(photo({ width: 509, height: 777, page, seed: 6 }));
		expect(quad).not.toBeNull();
		expect(error(quad!, page)).toBeLessThan(9);
	});

	it('keeps the corners inside the photo when the page runs off its edge', () => {
		const page: Quad = [
			{ x: 300, y: -40 },
			{ x: 700, y: -20 },
			{ x: 690, y: 400 },
			{ x: 290, y: 380 }
		];
		const quad = findPage(photo({ width: 640, height: 480, page, seed: 7 }));
		expect(quad).not.toBeNull();
		for (const p of quad!) {
			expect(p.x).toBeGreaterThanOrEqual(0);
			expect(p.x).toBeLessThanOrEqual(640);
			expect(p.y).toBeGreaterThanOrEqual(0);
			expect(p.y).toBeLessThanOrEqual(480);
		}
		// The two corners on the desk are where they are.
		expect(Math.hypot(quad![3].x - 290, quad![3].y - 380)).toBeLessThan(8);
	});

	it('finds nothing in a photo of the desk alone', () => {
		expect(findPage(photo({ width: 640, height: 480, seed: 8 }))).toBeNull();
	});

	it('finds nothing in a photo of noise', () => {
		const rand = random(9);
		const data = new Uint8ClampedArray(320 * 240 * 4);
		for (let i = 0; i < data.length; i += 4) {
			const v = rand() * 255;
			data.set([v, v, v, 255], i);
		}
		expect(findPage({ width: 320, height: 240, data })).toBeNull();
	});

	it('finds nothing when the page is as light as what it’s on', () => {
		const page: Quad = [
			{ x: 170, y: 60 },
			{ x: 462, y: 52 },
			{ x: 470, y: 440 },
			{ x: 164, y: 446 }
		];
		const scene = {
			width: 640,
			height: 480,
			page,
			desk: [236, 234, 230] as [number, number, number]
		};
		expect(findPage(photo({ ...scene, seed: 10 }))).toBeNull();
	});

	it('finds nothing when the page fills the photo', () => {
		const page: Quad = [
			{ x: -30, y: -30 },
			{ x: 670, y: -30 },
			{ x: 670, y: 510 },
			{ x: -30, y: 510 }
		];
		expect(findPage(photo({ width: 640, height: 480, page, seed: 11 }))).toBeNull();
	});

	it('finds nothing when the bright shape isn’t four-cornered', () => {
		// A white plate on the desk: bright and solid, but round.
		const width = 640;
		const height = 480;
		const desk = photo({ width, height, seed: 12 });
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++)
				if (Math.hypot(x - 320, y - 240) < 180) desk.data.set([240, 240, 236], (y * width + x) * 4);
		expect(findPage(desk)).toBeNull();
	});

	it('finds nothing in a photo of one colour, or a tiny one', () => {
		const flat = new Uint8ClampedArray(64 * 48 * 4).fill(200);
		expect(findPage({ width: 64, height: 48, data: flat })).toBeNull();
		expect(
			findPage({ width: 1, height: 1, data: new Uint8ClampedArray([9, 9, 9, 255]) })
		).toBeNull();
	});

	it('refuses pixels that don’t match their size, and a bad frame size', () => {
		for (const bad of [
			{ width: 5, height: 4, data: new Uint8ClampedArray(64) },
			{ width: 0, height: 0, data: new Uint8ClampedArray(0) },
			{ width: 2.5, height: 4, data: new Uint8ClampedArray(40) }
		])
			expect(() => findPage(bad)).toThrow(RangeError);
		const ok = { width: 4, height: 4, data: new Uint8ClampedArray(64) };
		for (const size of [0, 8, 20.5, NaN]) expect(() => findPage(ok, { size })).toThrow(RangeError);
	});
});

describe('startCorners', () => {
	it('starts from the page it finds', () => {
		const page: Quad = [
			{ x: 170, y: 60 },
			{ x: 462, y: 52 },
			{ x: 470, y: 440 },
			{ x: 164, y: 446 }
		];
		const start = startCorners(photo({ width: 640, height: 480, page }));
		expect(start.found).toBe(true);
		expect(error(start.quad, page)).toBeLessThan(8);
	});

	it('starts from the whole photo when there’s no page', () => {
		expect(startCorners(photo({ width: 640, height: 480, seed: 8 }))).toEqual({
			quad: rectangle(640, 480),
			found: false
		});
	});
});
