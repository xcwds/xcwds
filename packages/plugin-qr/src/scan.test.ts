import { beforeAll, describe, expect, it, vi } from 'vitest';
import { scan, type ScanEnv } from './scan.js';

beforeAll(() => {
	// Node has no ImageData; scan only checks the class.
	class FakeImageData {
		constructor(
			readonly data: Uint8ClampedArray,
			readonly width: number,
			readonly height: number
		) {}
	}
	vi.stubGlobal('ImageData', FakeImageData);
});

const image = () =>
	new (globalThis as unknown as { ImageData: new (...a: unknown[]) => ImageData }).ImageData(
		new Uint8ClampedArray(4),
		1,
		1
	);

function detector(supported: string[], found: { rawValue: string; format: string }[] | Error) {
	const made: string[][] = [];
	class Detector {
		static getSupportedFormats = async () => supported;
		constructor({ formats }: { formats: string[] }) {
			made.push(formats);
		}
		async detect() {
			if (found instanceof Error) throw found;
			return found;
		}
	}
	return { Detector, made };
}

describe('scan', () => {
	it("uses the browser's detector where it reads the format, and parses what it finds", async () => {
		const { Detector, made } = detector(
			['qr_code', 'ean_13'],
			[{ rawValue: 'WIFI:S:Home;T:WPA;P:pw;;', format: 'qr_code' }]
		);
		const decode = vi.fn();
		const env: ScanEnv = { BarcodeDetector: Detector, decode };
		expect(await scan(image(), { env })).toEqual({
			format: 'qr_code',
			text: 'WIFI:S:Home;T:WPA;P:pw;;',
			kind: 'wifi',
			wifi: { ssid: 'Home', security: 'WPA', password: 'pw', hidden: false }
		});
		expect(made).toEqual([['qr_code']]);
		expect(decode).not.toHaveBeenCalled();
	});

	it('finds nothing without falling back when the detector looked for QR codes itself', async () => {
		const { Detector } = detector(['qr_code'], []);
		const decode = vi.fn();
		expect(await scan(image(), { env: { BarcodeDetector: Detector, decode } })).toBeNull();
		expect(decode).not.toHaveBeenCalled();
	});

	it('falls back to the bundled decoder for QR codes without a detector, or when it fails', async () => {
		const decode = vi.fn(async () => 'https://example.com');
		const expected = {
			format: 'qr_code',
			text: 'https://example.com',
			kind: 'url',
			url: 'https://example.com/'
		};
		expect(await scan(image(), { env: { BarcodeDetector: null, decode } })).toEqual(expected);
		const broken = detector(['qr_code'], new Error('busy'));
		expect(await scan(image(), { env: { BarcodeDetector: broken.Detector, decode } })).toEqual(
			expected
		);
		// A detector without QR codes (some desktop ones) leaves them to the decoder too.
		const eanOnly = detector(['ean_13'], []);
		expect(await scan(image(), { env: { BarcodeDetector: eanOnly.Detector, decode } })).toEqual(
			expected
		);
		expect(decode).toHaveBeenCalledTimes(3);
	});

	it('reads other formats only where the detector has them', async () => {
		const decode = vi.fn(async () => null);
		const ean = detector(['ean_13'], [{ rawValue: '4006381333931', format: 'ean_13' }]);
		expect(
			await scan(image(), { formats: ['ean_13'], env: { BarcodeDetector: ean.Detector, decode } })
		).toEqual({ format: 'ean_13', text: '4006381333931', kind: 'text' });
		expect(
			await scan(image(), { formats: ['ean_13'], env: { BarcodeDetector: null, decode } })
		).toBeNull();
		expect(decode).not.toHaveBeenCalled();
	});

	it('returns null when the decoder finds no code', async () => {
		const decode = vi.fn(async () => null);
		expect(await scan(image(), { env: { BarcodeDetector: null, decode } })).toBeNull();
		expect(decode).toHaveBeenCalledOnce();
	});
});

describe('scan, in a browser without a detector', () => {
	it('shrinks large pixel arrays before decoding, and leaves small ones as they are', async () => {
		const drawn: number[][] = [];
		const bitmaps: unknown[] = [];
		vi.stubGlobal('createImageBitmap', async (source: unknown) => {
			bitmaps.push(source);
			return { width: 4000, height: 3000, close() {} };
		});
		vi.stubGlobal(
			'OffscreenCanvas',
			class {
				constructor(
					readonly width: number,
					readonly height: number
				) {
					drawn.push([width, height]);
				}
				getContext() {
					return {
						fillRect() {},
						drawImage() {},
						getImageData: (_x: number, _y: number, w: number, h: number) => ({
							data: new Uint8ClampedArray(w * h * 4),
							width: w,
							height: h
						})
					};
				}
			}
		);
		const sizes: string[] = [];
		const decode = async (pixels: { width: number; height: number }) => {
			sizes.push(`${pixels.width}x${pixels.height}`);
			return null;
		};
		const ImageDataClass = (
			globalThis as unknown as { ImageData: new (...a: unknown[]) => ImageData }
		).ImageData;
		const large = new ImageDataClass(new Uint8ClampedArray(4), 4000, 3000);
		await scan(large, { env: { BarcodeDetector: null, decode } });
		await scan(image(), { env: { BarcodeDetector: null, decode } });
		expect(bitmaps).toEqual([large]);
		expect(drawn).toEqual([[1024, 768]]);
		expect(sizes).toEqual(['1024x768', '1x1']);
		vi.unstubAllGlobals();
	});
});
