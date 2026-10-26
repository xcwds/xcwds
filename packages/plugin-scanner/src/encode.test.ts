import { afterEach, describe, expect, it, vi } from 'vitest';
import { JPEG_QUALITY, encodeJpeg, jpegQuality, onWhite } from './encode.js';
import type { Pixels } from './warp.js';

function image(width: number, height: number, rgba: number[]): Pixels {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let p = 0; p < data.length; p += 4) data.set(rgba, p);
	return { width, height, data };
}

class FakeImageData {
	constructor(
		readonly data: Uint8ClampedArray,
		readonly width: number,
		readonly height: number
	) {
		if (data.length !== width * height * 4) throw new DOMException('size', 'IndexSizeError');
	}
}

/** A 2D canvas that records what was put on it and "encodes" it as `writes`. */
function fakeCanvas(options: { writes?: string; context?: boolean; fails?: boolean } = {}) {
	const { writes = 'image/jpeg', context = true, fails = false } = options;
	const put: FakeImageData[] = [];
	const asked: { type: string; quality: number }[] = [];
	const blob = (type: string, quality: number) => {
		asked.push({ type, quality });
		if (fails) throw new DOMException('too big', 'EncodingError');
		return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: writes });
	};
	const ctx = { putImageData: (image: FakeImageData) => put.push(image) };
	class Canvas {
		constructor(
			public width = 0,
			public height = 0
		) {}
		getContext() {
			return context ? ctx : null;
		}
		async convertToBlob({ type, quality }: { type: string; quality: number }) {
			return blob(type, quality);
		}
		toBlob(done: (b: Blob | null) => void, type: string, quality: number) {
			let b: Blob | null = null;
			try {
				b = blob(type, quality);
			} catch {
				// A canvas that can't encode calls back with null.
			}
			setTimeout(() => done(b));
		}
	}
	return { Canvas, put, asked };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('jpegQuality', () => {
	it('defaults to JPEG_QUALITY and takes 0 to 1', () => {
		expect(jpegQuality()).toBe(JPEG_QUALITY);
		for (const q of [0, 0.5, 1]) expect(jpegQuality(q)).toBe(q);
	});

	it('refuses anything else', () => {
		for (const q of [-0.1, 1.1, NaN, Infinity, '0.5', null])
			expect(() => jpegQuality(q as number)).toThrow(RangeError);
	});
});

describe('onWhite', () => {
	it('leaves an opaque page as it is', () => {
		const page = image(3, 2, [10, 20, 30, 255]);
		expect(onWhite(page)).toBe(page);
	});

	it('puts see-through pixels on white', () => {
		const page = image(2, 1, [200, 0, 0, 255]);
		page.data.set([0, 0, 0, 0], 4);
		const before = page.data.slice();
		const white = onWhite(page);
		expect([...white.data]).toEqual([200, 0, 0, 255, 255, 255, 255, 255]);
		expect(onWhite(image(1, 1, [0, 0, 255, 128])).data).toEqual(
			new Uint8ClampedArray([127, 127, 255, 255])
		);
		// The page itself is untouched.
		expect(page.data).toEqual(before);
	});
});

describe('encodeJpeg', () => {
	it('encodes on an OffscreenCanvas at the quality asked for', async () => {
		const { Canvas, put, asked } = fakeCanvas();
		vi.stubGlobal('ImageData', FakeImageData);
		vi.stubGlobal('OffscreenCanvas', Canvas);
		const page = image(4, 3, [1, 2, 3, 255]);
		const blob = await encodeJpeg(page, { quality: 0.7 });
		expect(blob?.type).toBe('image/jpeg');
		expect(asked).toEqual([{ type: 'image/jpeg', quality: 0.7 }]);
		expect(put).toHaveLength(1);
		expect(put[0]).toMatchObject({ width: 4, height: 3 });
		expect(put[0]!.data).toBe(page.data);
		await encodeJpeg(page);
		expect(asked[1]!.quality).toBe(JPEG_QUALITY);
	});

	it('encodes a see-through page on white', async () => {
		const { Canvas, put } = fakeCanvas();
		vi.stubGlobal('ImageData', FakeImageData);
		vi.stubGlobal('OffscreenCanvas', Canvas);
		await encodeJpeg(image(1, 1, [0, 0, 0, 0]));
		expect([...put[0]!.data]).toEqual([255, 255, 255, 255]);
	});

	it('falls back to a <canvas> where there’s no OffscreenCanvas', async () => {
		const { Canvas, put, asked } = fakeCanvas();
		vi.stubGlobal('ImageData', FakeImageData);
		vi.stubGlobal('OffscreenCanvas', undefined);
		vi.stubGlobal('document', { createElement: () => new Canvas() });
		const blob = await encodeJpeg(image(2, 2, [9, 9, 9, 255]), { quality: 0.8 });
		expect(blob?.type).toBe('image/jpeg');
		expect(asked).toEqual([{ type: 'image/jpeg', quality: 0.8 }]);
		expect(put[0]).toMatchObject({ width: 2, height: 2 });
	});

	it('gives null where it can’t make a JPEG', async () => {
		const page = image(2, 2, [9, 9, 9, 255]);
		// Node: no canvas at all.
		expect(await encodeJpeg(page)).toBeNull();
		vi.stubGlobal('ImageData', FakeImageData);
		expect(await encodeJpeg(page)).toBeNull();
		for (const options of [{ writes: 'image/png' }, { context: false }, { fails: true }]) {
			vi.stubGlobal('OffscreenCanvas', fakeCanvas(options).Canvas);
			expect(await encodeJpeg(page)).toBeNull();
			vi.stubGlobal('OffscreenCanvas', undefined);
			vi.stubGlobal('document', { createElement: () => new (fakeCanvas(options).Canvas)() });
			expect(await encodeJpeg(page)).toBeNull();
			vi.unstubAllGlobals();
			vi.stubGlobal('ImageData', FakeImageData);
		}
	});

	it('refuses a bad quality and pixels that don’t match their size', async () => {
		vi.stubGlobal('ImageData', FakeImageData);
		vi.stubGlobal('OffscreenCanvas', fakeCanvas().Canvas);
		const page = image(2, 2, [9, 9, 9, 255]);
		await expect(encodeJpeg(page, { quality: 2 })).rejects.toThrow(RangeError);
		for (const bad of [
			{ ...page, width: 3 },
			{ ...page, height: 0 },
			{ ...page, width: 1.5 },
			{ ...page, data: Array.from(page.data) }
		])
			await expect(encodeJpeg(bad as Pixels)).rejects.toThrow(RangeError);
	});
});
