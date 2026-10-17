import jsqr from 'jsqr';
import { describe, expect, it } from 'vitest';
import {
	encodeQr,
	qrPath,
	qrSvg,
	QrTooLongError,
	type ErrorCorrection,
	type QrMatrix
} from './make.js';

// jsQR is CommonJS with an ES-style default in its types.
const jsQR = ((jsqr as unknown as { default?: unknown }).default ??
	jsqr) as typeof import('jsqr').default;

/** Draws the code as pixels (with a margin) and reads it back with an independent decoder. */
function decode(matrix: QrMatrix, scale = 3, margin = 4) {
	const side = (matrix.size + margin * 2) * scale;
	const data = new Uint8ClampedArray(side * side * 4).fill(255);
	for (let y = 0; y < matrix.size; y++)
		for (let x = 0; x < matrix.size; x++) {
			if (!matrix.modules[y * matrix.size + x]) continue;
			for (let dy = 0; dy < scale; dy++)
				for (let dx = 0; dx < scale; dx++) {
					const i = (((y + margin) * scale + dy) * side + (x + margin) * scale + dx) * 4;
					data[i] = data[i + 1] = data[i + 2] = 0;
				}
		}
	return jsQR(data, side, side, { inversionAttempts: 'dontInvert' });
}

describe('encodeQr', () => {
	it('makes a version 1 code for short text, and a decoder reads it back', () => {
		const matrix = encodeQr('hello', { boost: false });
		expect(matrix).toMatchObject({ size: 21, version: 1, errorCorrection: 'M' });
		expect(matrix.modules).toHaveLength(21 * 21);
		expect(decode(matrix)?.data).toBe('hello');
	});

	it('round-trips at every level and across versions 1 to 40', () => {
		const levels: ErrorCorrection[] = ['L', 'M', 'Q', 'H'];
		// Lengths that land in versions 1 to 40 at every level, ending at each level's limit.
		const limits = { L: 2953, M: 2331, Q: 1663, H: 1273 };
		for (const level of levels) {
			const lengths = [1, 20, 60, 120, 250, 400, 700, 1000, limits[level]];
			const seen = new Set<number>();
			for (const length of lengths) {
				if (length > limits[level]) continue;
				const text = Array.from({ length }, (_, i) =>
					String.fromCharCode(33 + ((i * 7) % 90))
				).join('');
				const matrix = encodeQr(text, { errorCorrection: level, boost: false });
				expect(matrix.size).toBe(matrix.version * 4 + 17);
				expect(decode(matrix)?.data, `${level} ${length}`).toBe(text);
				seen.add(matrix.version);
			}
			expect(seen.has(40), level).toBe(true);
			expect(seen.has(1), level).toBe(true);
		}
	});

	it('round-trips every version from 1 to 40', { timeout: 60_000 }, () => {
		// Each version holds at least 9 more bytes than the last at Q, so steps of 7 meet them all.
		for (let version = 1, length = 1; version <= 40; length += 7) {
			const text = 'x'.repeat(length);
			const matrix = encodeQr(text, { errorCorrection: 'Q', boost: false });
			if (matrix.version < version) continue;
			expect(matrix.version).toBe(version);
			expect(decode(matrix, 2)?.data, `version ${version}`).toBe(text);
			version++;
		}
	});

	it('encodes text as UTF-8', () => {
		const text = 'Café ☕ 東京 🙂';
		const result = decode(encodeQr(text));
		expect(new TextDecoder().decode(new Uint8Array(result!.binaryData))).toBe(text);
	});

	it('raises the error correction while it fits the same version, unless told not to', () => {
		expect(encodeQr('hi')).toMatchObject({ version: 1, errorCorrection: 'H' });
		expect(encodeQr('hi', { boost: false }).errorCorrection).toBe('M');
		const long = 'a'.repeat(14);
		expect(encodeQr(long, { errorCorrection: 'L' })).toMatchObject({
			version: 1,
			errorCorrection: 'M'
		});
	});

	it('says when the text is too long', () => {
		expect(() => encodeQr('a'.repeat(1274), { errorCorrection: 'H' })).toThrow(QrTooLongError);
		expect(() => encodeQr('a'.repeat(2954), { errorCorrection: 'L' })).toThrow(/too long/);
		expect(encodeQr('a'.repeat(2953), { errorCorrection: 'L' }).version).toBe(40);
		expect(() => encodeQr('a', { errorCorrection: 'X' as ErrorCorrection })).toThrow(TypeError);
	});

	it('is deterministic', () => {
		expect(encodeQr('same text').modules).toEqual(encodeQr('same text').modules);
	});
});

describe('qrSvg', () => {
	it('draws black on white with a quiet zone, labelled with the text', () => {
		const svg = qrSvg('https://example.com/?a=1&b="2"');
		expect(svg).toMatch(
			/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 37 37" role="img"/
		);
		expect(svg).toContain('aria-label="QR code: https://example.com/?a=1&amp;b=&quot;2&quot;"');
		expect(svg).toContain('<rect width="37" height="37" fill="#fff"/>');
		expect(svg).toContain('<path fill="#000" d="M4 4h7v1h-7z');
		expect(svg).not.toMatch(/<script|on\w+=/);
	});

	it('takes a margin and a label', () => {
		const svg = qrSvg('hi', { margin: 0, label: 'Wi-Fi <code>' });
		expect(svg).toContain('viewBox="0 0 21 21"');
		expect(svg).toContain('aria-label="Wi-Fi &lt;code&gt;"');
		expect(() => qrSvg('hi', { margin: -1 })).toThrow(/margin/);
		expect(() => qrSvg('hi', { margin: 1.5 })).toThrow(/margin/);
	});

	it('has a path that covers exactly the dark modules', () => {
		const matrix = encodeQr('path check');
		const d = qrPath(matrix, 2);
		const dark = new Set<string>();
		for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g))
			for (let i = 0; i < Number(w); i++) dark.add(`${Number(x) - 2 + i},${Number(y) - 2}`);
		const expected = new Set<string>();
		matrix.modules.forEach((on, i) => {
			if (on) expected.add(`${i % matrix.size},${Math.floor(i / matrix.size)}`);
		});
		expect(dark).toEqual(expected);
	});
});
