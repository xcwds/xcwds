import { describe, expect, it, vi } from 'vitest';
import {
	CORNERS,
	CROSSED,
	clamp,
	cropProblem,
	keyStep,
	moveCorner,
	nudge,
	readPhoto,
	toPhoto,
	type ReadEnv
} from './crop.js';
import { rectangle, type Quad } from './geometry.js';

const size = { width: 400, height: 300 };
const page: Quad = [
	{ x: 50, y: 40 },
	{ x: 350, y: 30 },
	{ x: 360, y: 270 },
	{ x: 40, y: 260 }
];

describe('corner handles', () => {
	it('names the corners in a quad’s order', () => {
		expect(CORNERS).toEqual(['Top left', 'Top right', 'Bottom right', 'Bottom left']);
	});

	it('keeps points inside the photo', () => {
		expect(clamp({ x: -5, y: 320 }, size)).toEqual({ x: 0, y: 300 });
		expect(clamp({ x: 120, y: 80 }, size)).toEqual({ x: 120, y: 80 });
	});

	it('moves one corner and leaves the rest', () => {
		const moved = moveCorner(page, 2, { x: 500, y: 200 }, size);
		expect(moved).toEqual([page[0], page[1], { x: 400, y: 200 }, page[3]]);
		expect(page[2]).toEqual({ x: 360, y: 270 });
	});

	it('refuses a corner that isn’t 0 to 3', () => {
		expect(() => moveCorner(page, 4, { x: 0, y: 0 }, size)).toThrow(RangeError);
		expect(() => moveCorner(page, 1.5, { x: 0, y: 0 }, size)).toThrow(RangeError);
		expect(() => nudge(page, -1, 'ArrowLeft', size)).toThrow(RangeError);
	});

	it('maps a pointer on screen to the photo’s pixels', () => {
		// The photo shown at half size, 100 px from the left and 20 px down.
		const rect = { left: 100, top: 20, width: 200, height: 150 };
		expect(toPhoto({ x: 150, y: 95 }, rect, size)).toEqual({ x: 100, y: 150 });
		expect(toPhoto({ x: 0, y: 500 }, rect, size)).toEqual({ x: 0, y: 300 });
	});

	it('steps 1% of the shorter side, or 10% with Shift', () => {
		expect(keyStep(size)).toBe(3);
		expect(keyStep(size, true)).toBe(30);
		expect(keyStep({ width: 40, height: 30 })).toBe(1);
	});

	it('moves a corner with the arrow keys and ignores other keys', () => {
		expect(nudge(page, 0, 'ArrowLeft', size)![0]).toEqual({ x: 47, y: 40 });
		expect(nudge(page, 0, 'ArrowRight', size)![0]).toEqual({ x: 53, y: 40 });
		expect(nudge(page, 0, 'ArrowUp', size, true)![0]).toEqual({ x: 50, y: 10 });
		expect(nudge(page, 3, 'ArrowDown', size, true)![3]).toEqual({ x: 40, y: 290 });
		expect(nudge(page, 2, 'ArrowDown', size, true)![2]).toEqual({ x: 360, y: 300 });
		expect(nudge(page, 0, 'Enter', size)).toBeNull();
	});

	it('says when the corners don’t make a page', () => {
		expect(cropProblem(page)).toBe('');
		expect(cropProblem(rectangle(400, 300))).toBe('');
		// Top right dragged past the bottom right: the sides cross.
		expect(cropProblem(moveCorner(page, 1, { x: 380, y: 290 }, size))).toBe(CROSSED);
		// Two corners in one place.
		expect(cropProblem(moveCorner(page, 1, page[0], size))).toBe(CROSSED);
	});
});

describe('readPhoto', () => {
	/** A canvas stand-in that records what was drawn and hands back pixels of that size. */
	function fakeEnv(bitmap: { width: number; height: number }) {
		const close = vi.fn();
		const drawImage = vi.fn();
		const env = {
			createImageBitmap: vi.fn(async () => ({ ...bitmap, close }) as unknown as ImageBitmap),
			canvas: vi.fn(
				(width: number, height: number) =>
					({
						getContext: () => ({
							drawImage,
							getImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) })
						})
					}) as unknown as OffscreenCanvas
			)
		} satisfies ReadEnv;
		return { env, close, drawImage };
	}

	it('opens a photo upright at its own size', async () => {
		const { env, close, drawImage } = fakeEnv({ width: 40, height: 30 });
		const photo = new Blob([], { type: 'image/jpeg' });
		const pixels = await readPhoto(photo, {}, env);
		expect(pixels).toMatchObject({ width: 40, height: 30 });
		expect(pixels!.data).toHaveLength(40 * 30 * 4);
		expect(env.createImageBitmap).toHaveBeenCalledWith(photo, { imageOrientation: 'from-image' });
		expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 40, 30);
		expect(close).toHaveBeenCalled();
	});

	it('scales a large photo down to max', async () => {
		const { env, close } = fakeEnv({ width: 4000, height: 3000 });
		const pixels = await readPhoto(new Blob(), { max: 1000 }, env);
		expect(pixels).toMatchObject({ width: 1000, height: 750 });
		expect(env.canvas).toHaveBeenCalledWith(1000, 750);
		expect(close).toHaveBeenCalled();
	});

	it('gives null when the photo can’t be decoded or drawn', async () => {
		const failing = { createImageBitmap: vi.fn(async () => Promise.reject(new Error('bad'))) };
		expect(await readPhoto(new Blob(), {}, failing)).toBeNull();

		const { env, close } = fakeEnv({ width: 10, height: 10 });
		expect(await readPhoto(new Blob(), {}, { ...env, canvas: () => null })).toBeNull();
		expect(close).toHaveBeenCalled();

		const thrown = fakeEnv({ width: 10, height: 10 });
		const tooBig = () => {
			throw new Error('out of memory');
		};
		expect(await readPhoto(new Blob(), {}, { ...thrown.env, canvas: tooBig })).toBeNull();
		expect(thrown.close).toHaveBeenCalled();
	});

	it('gives null without createImageBitmap (Node)', async () => {
		expect(await readPhoto(new Blob())).toBeNull();
	});

	it('refuses a bad max', async () => {
		await expect(readPhoto(new Blob(), { max: 0 })).rejects.toThrow(RangeError);
		await expect(readPhoto(new Blob(), { max: 9000 })).rejects.toThrow(RangeError);
	});
});
