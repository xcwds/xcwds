import { describe, expect, it } from 'vitest';
import { decodeQr, type Pixels } from './decode.js';
import { encodeQr } from './encode.js';

/** A code as RGBA pixels, `scale` per module, with a light (or dark, if `inverted`) margin. */
function pixels(text: string, { scale = 4, inverted = false } = {}): Pixels {
	const matrix = encodeQr(text);
	const margin = 4;
	const side = (matrix.size + margin * 2) * scale;
	const data = new Uint8ClampedArray(side * side * 4);
	for (let y = 0; y < side; y++)
		for (let x = 0; x < side; x++) {
			const mx = Math.floor(x / scale) - margin;
			const my = Math.floor(y / scale) - margin;
			const inside = mx >= 0 && my >= 0 && mx < matrix.size && my < matrix.size;
			const dark = inside && matrix.modules[my * matrix.size + mx]!;
			const value = dark !== inverted ? 0 : 255;
			data.fill(value, (y * side + x) * 4, (y * side + x) * 4 + 3);
			data[(y * side + x) * 4 + 3] = 255;
		}
	return { data, width: side, height: side };
}

describe('decodeQr', () => {
	it('reads a code, as UTF-8', () => {
		expect(decodeQr(pixels('https://example.com'))).toBe('https://example.com');
		expect(decodeQr(pixels('Grüße, 東京 🙂'))).toBe('Grüße, 東京 🙂');
	});

	it('reads a light-on-dark code too', () => {
		expect(decodeQr(pixels('inverted', { inverted: true }))).toBe('inverted');
	});

	it('finds nothing in an image without a code', () => {
		const blank = new Uint8ClampedArray(200 * 200 * 4).fill(255);
		expect(decodeQr({ data: blank, width: 200, height: 200 })).toBeNull();
	});
});
