// The GPU path in Node: its checks, every way it gives `null` for `warp` to take over, and how it
// splits a page into strips. A WebGL 2 stand-in records the calls; the real GPU's output is
// compared with `warp`'s in examples/minimal/e2e/scanner-warp.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { rectangle, type Quad } from './geometry.js';
import { MAX_SIDE, warp, type Pixels } from './warp.js';
import { STRIP_PIXELS, warpGl } from './warp-gl.js';

function image(width: number, height: number): Pixels {
	return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/**
 * A WebGL 2 context that answers every call: constants are numbers, methods record their calls in
 * `calls`, and `overrides` replace any of them.
 */
function fakeGl(overrides: Record<string, unknown> = {}) {
	const calls: { name: string; args: unknown[] }[] = [];
	const constants = new Map<string, number>();
	const loseContext = vi.fn();
	const gl: Record<string, unknown> = new Proxy(
		{},
		{
			get(_target, name: string) {
				if (name in overrides) return overrides[name];
				if (/^[A-Z0-9_]+$/.test(name)) {
					if (!constants.has(name)) constants.set(name, constants.size + 1);
					return constants.get(name);
				}
				return (...args: unknown[]) => {
					calls.push({ name, args });
					switch (name) {
						case 'getParameter':
							return args[0] === gl.MAX_VIEWPORT_DIMS
								? new Int32Array([MAX_SIDE, MAX_SIDE])
								: MAX_SIDE;
						case 'getExtension':
							return args[0] === 'WEBGL_lose_context' ? { loseContext } : null;
						case 'checkFramebufferStatus':
							return gl.FRAMEBUFFER_COMPLETE;
						case 'getError':
							return gl.NO_ERROR;
						case 'getProgramParameter':
							return true;
						case 'isContextLost':
							return false;
						default:
							return {};
					}
				};
			}
		}
	);
	const canvas = { getContext: vi.fn(() => gl) };
	return { gl, calls, loseContext, canvas: () => canvas as unknown as OffscreenCanvas };
}

describe('warpGl', () => {
	const quad = rectangle(4, 4);
	const size = { width: 4, height: 4 };

	it('refuses what warp refuses before reaching the GPU', () => {
		const canvas = vi.fn(() => null);
		expect(() => warpGl(image(4, 4), quad, { width: 0, height: 4 }, { canvas })).toThrow(
			RangeError
		);
		expect(() => warpGl(image(4, 4), quad, { width: MAX_SIDE + 1, height: 4 }, { canvas })).toThrow(
			RangeError
		);
		expect(() =>
			warpGl({ width: 5, height: 4, data: new Uint8ClampedArray(64) }, quad, size, { canvas })
		).toThrow(RangeError);
		const flat: Quad = [
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 4, y: 0 },
			{ x: 0, y: 4 }
		];
		expect(() => warpGl(image(4, 4), flat, size, { canvas })).toThrow(/one line/);
		expect(canvas).not.toHaveBeenCalled();
	});

	it('gives null where there is no canvas or no WebGL 2', () => {
		// Node has neither an OffscreenCanvas nor a document.
		expect(warpGl(image(4, 4), quad, size)).toBeNull();
		expect(warpGl(image(4, 4), quad, size, { canvas: () => null })).toBeNull();
		const noContext = { getContext: () => null } as unknown as OffscreenCanvas;
		expect(warpGl(image(4, 4), quad, size, { canvas: () => noContext })).toBeNull();
		const throws = {
			getContext: () => {
				throw new Error('no GPU process');
			}
		} as unknown as OffscreenCanvas;
		expect(warpGl(image(4, 4), quad, size, { canvas: () => throws })).toBeNull();
	});

	it('gives null, and the context back, when the photo or page is too large for the GPU', () => {
		const limited = (texture: number, viewport: number) => {
			const fake = fakeGl({
				getParameter: (p: unknown) =>
					p === fake.gl.MAX_VIEWPORT_DIMS ? new Int32Array([viewport, viewport]) : texture
			});
			return fake;
		};
		for (const [photo, page, fake] of [
			[image(4097, 2), size, limited(4096, 16384)],
			[image(2, 4097), size, limited(4096, 16384)],
			[image(4, 4), { width: 4097, height: 4 }, limited(4096, 16384)],
			// The viewport limits the page too.
			[image(4, 4), { width: 3000, height: 4 }, limited(8192, 2048)]
		] as const) {
			expect(warpGl(photo, rectangle(photo.width, photo.height), page, fake)).toBeNull();
			expect(fake.loseContext).toHaveBeenCalledOnce();
			expect(fake.calls.map((c) => c.name)).not.toContain('drawArrays');
		}
		// Within the limits, it draws.
		const fits = limited(4096, 4096);
		expect(warpGl(image(4096, 2), rectangle(4096, 2), { width: 4096, height: 4 }, fits)).not.toBe(
			null
		);
	});

	it('gives null, and the context back, when the GPU fails', () => {
		const failures: Record<string, unknown>[] = [
			{ getProgramParameter: () => false },
			{ createShader: () => null },
			{ checkFramebufferStatus: () => -1 },
			{ getError: () => -1 },
			{ isContextLost: () => true },
			{
				drawArrays: () => {
					throw new Error('lost');
				}
			}
		];
		for (const failure of failures) {
			const fake = fakeGl(failure);
			expect(warpGl(image(4, 4), quad, size, fake)).toBeNull();
			expect(fake.loseContext).toHaveBeenCalledOnce();
		}
	});

	/** A photo whose every pixel differs from its neighbours, so a misplaced row shows. */
	const busy = () => {
		const photo = image(16, 16);
		for (let i = 0; i < photo.data.length; i++) photo.data[i] = (i * 37) % 256;
		return photo;
	};

	/** A stand-in GPU that draws each strip right: `warp`'s rows from the strip's top down. */
	function drawsRight(expected: Pixels) {
		let top = 0;
		const reads: number[][] = [];
		const fake = fakeGl({
			uniform1f: (_location: unknown, value: number) => (top = value),
			readPixels: (...args: unknown[]) => {
				const [x, y, w, h, , , view] = args as [number, number, number, number, 0, 0, Uint8Array];
				reads.push([x, y, w, h]);
				const row = expected.width * 4;
				view.set(expected.data.subarray(top * row, (top + h) * row));
			}
		});
		return { ...fake, reads };
	}

	it('draws the page in strips and reads each into its own rows', () => {
		const width = 8192;
		const height = 1100;
		const rows = STRIP_PIXELS / width;
		const photo = busy();
		const expected = warp(photo, rectangle(16, 16), { width, height });
		const fake = drawsRight(expected);
		const out = warpGl(photo, rectangle(16, 16), { width, height }, fake)!;
		expect(out).toMatchObject({ width, height });
		expect(fake.reads).toEqual([
			[0, 0, width, rows],
			[0, 0, width, rows],
			[0, 0, width, height - rows * 2]
		]);
		const viewports = fake.calls.filter((c) => c.name === 'viewport').map((c) => c.args);
		expect(viewports).toEqual(fake.reads);
		// Each strip landed in its own rows, top first, and every row was read.
		let wrong = 0;
		for (let i = 0; i < out.data.length; i++) if (out.data[i] !== expected.data[i]) wrong++;
		expect(wrong).toBe(0);
		// The homography goes over in row order, for WebGL 2 to transpose.
		const matrix = fake.calls.find((c) => c.name === 'uniformMatrix3fv')!;
		expect(matrix.args[1]).toBe(true);
		expect(fake.loseContext).toHaveBeenCalledOnce();
	});

	it('gives null when the page the GPU drew is wrong where it is checked', () => {
		const photo = busy();
		const page = { width: 300, height: 200 };
		const quad: Quad = [
			{ x: 1, y: 2 },
			{ x: 15, y: 0.5 },
			{ x: 14, y: 15 },
			{ x: 0, y: 13 }
		];
		const expected = warp(photo, quad, page);
		// Right, then off by a shade or two everywhere: still the page.
		expect(warpGl(photo, quad, page, drawsRight(expected))).not.toBeNull();
		const close = { ...expected, data: expected.data.map((v, i) => v + (i % 2 ? 1 : -1)) };
		expect(warpGl(photo, quad, page, drawsRight(close))).not.toBeNull();
		// Wrong: blank, rows upside down, or wrong in one spot that's checked (the centre).
		const blank = { ...expected, data: new Uint8ClampedArray(expected.data.length) };
		const flipped = { ...expected, data: new Uint8ClampedArray(expected.data.length) };
		const row = page.width * 4;
		for (let y = 0; y < page.height; y++)
			flipped.data.set(expected.data.subarray(y * row, (y + 1) * row), (page.height - 1 - y) * row);
		const spot = { ...expected, data: expected.data.slice() };
		const centre = ((page.height >> 1) * page.width + (page.width >> 1)) * 4;
		spot.data[centre] = spot.data[centre]! > 127 ? 0 : 255;
		for (const wrong of [blank, flipped, spot]) {
			const fake = drawsRight(wrong);
			expect(warpGl(photo, quad, page, fake)).toBeNull();
			expect(fake.loseContext).toHaveBeenCalledOnce();
		}
	});

	it('draws a small page in one strip', () => {
		const fake = fakeGl();
		expect(warpGl(image(4, 4), quad, size, fake)).toMatchObject(size);
		expect(fake.calls.filter((c) => c.name === 'drawArrays')).toHaveLength(1);
	});
});
