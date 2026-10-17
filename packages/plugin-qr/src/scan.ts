/**
 * Reading codes from a still image (#147): a screenshot or photo picked from files. Uses the
 * browser's `BarcodeDetector` where it reads the format, otherwise (QR only) the bundled decoder in
 * a Worker. On the device either way. Safe to import during prerender: browser APIs are reached
 * only when `scan` runs.
 */
import { parseQr, type Parsed } from './parse.js';
import type { Pixels } from './decode.js';

export { parseQr } from './parse.js';
export type { Parsed, QrKind, WifiDetails } from './parse.js';

/** A format name as `BarcodeDetector` writes it: `qr_code`, `ean_13`, `code_128`… */
export type BarcodeFormat = string;

export interface ScanResult extends Parsed {
	format: BarcodeFormat;
	/** Exactly what the code holds. Never opened or followed: the page decides. */
	text: string;
}

/** An image to read: a file, a frame, a canvas or its pixels. */
export type ScanSource = Blob | ImageBitmap | HTMLCanvasElement | OffscreenCanvas | ImageData;

interface Detector {
	detect(source: ScanSource): Promise<{ rawValue: string; format: string }[]>;
}
interface DetectorClass {
	new (options: { formats: string[] }): Detector;
	getSupportedFormats(): Promise<string[]>;
}

/** What scanning uses of the browser; tests pass stand-ins. */
export interface ScanEnv {
	/** `null` acts as a browser without it. */
	BarcodeDetector?: DetectorClass | null;
	/** Decodes QR pixels off the page; the default runs the bundled decoder in a Worker. */
	decode?: (pixels: Pixels) => Promise<string | null>;
}

export interface ScanOptions {
	/** What to look for. Default `['qr_code']`; other formats only where `BarcodeDetector` has them. */
	formats?: BarcodeFormat[];
	env?: ScanEnv;
}

/** The longest side the fallback decodes at: plenty for a code, and quick. */
export const MAX_SIDE = 1024;

function detectorClass(env: ScanEnv): DetectorClass | undefined {
	if (env.BarcodeDetector !== undefined) return env.BarcodeDetector ?? undefined;
	return (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
}

/**
 * Runs the bundled decoder in its own Worker, which goes away with the answer. Where the Worker
 * can't start (offline before its file was ever fetched: service workers precache the app's pages
 * and chunks, not Vite's worker files), the decoder runs on the page instead.
 */
export async function decodeInWorker(pixels: Pixels): Promise<string | null> {
	try {
		return await new Promise<string | null>((resolve, reject) => {
			const worker = new Worker(new URL('./decode.worker.js', import.meta.url), { type: 'module' });
			const done = () => worker.terminate();
			worker.onmessage = (event: MessageEvent<string | null>) => {
				done();
				resolve(event.data);
			};
			worker.onerror = (event) => {
				done();
				event.preventDefault();
				reject(new Error(event.message || 'The QR decoder could not start.'));
			};
			// A copy goes over, so the page still has the pixels if the Worker fails.
			const data = pixels.data.slice();
			worker.postMessage({ data, width: pixels.width, height: pixels.height }, [data.buffer]);
		});
	} catch {
		const { decodeQr } = await import('./decode.js');
		return decodeQr(pixels);
	}
}

/** The image's pixels, at most `MAX_SIDE` on a side, upright as the photo was taken. */
async function pixelsOf(source: ScanSource): Promise<Pixels> {
	const isData = typeof ImageData !== 'undefined' && source instanceof ImageData;
	if (isData && Math.max(source.width, source.height) <= MAX_SIDE) return source;
	// Files and large pixel arrays become a bitmap to draw smaller (files upright, as taken).
	const bitmap = source instanceof Blob || isData;
	const image = bitmap
		? await createImageBitmap(source as Blob | ImageData, { imageOrientation: 'from-image' })
		: source;
	const { width, height } = image as { width: number; height: number };
	if (!width || !height) throw new Error('The image is empty.');
	const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
	const w = Math.max(1, Math.round(width * scale));
	const h = Math.max(1, Math.round(height * scale));
	const canvas =
		typeof OffscreenCanvas === 'function'
			? new OffscreenCanvas(w, h)
			: Object.assign(document.createElement('canvas'), { width: w, height: h });
	const context = canvas.getContext('2d', { willReadFrequently: true }) as
		CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
	if (!context) throw new Error("This browser can't read images here.");
	// Codes on transparent PNGs are dark on nothing: give them a light page to sit on.
	context.fillStyle = '#fff';
	context.fillRect(0, 0, w, h);
	context.drawImage(image as CanvasImageSource, 0, 0, w, h);
	if (bitmap) (image as ImageBitmap).close();
	return context.getImageData(0, 0, w, h);
}

const result = (format: string, text: string): ScanResult => ({ format, text, ...parseQr(text) });

/**
 * The first code found in `source`, or `null` when there's none. Rejects only when the image
 * itself can't be read.
 */
export async function scan(
	source: ScanSource,
	options: ScanOptions = {}
): Promise<ScanResult | null> {
	const env = options.env ?? {};
	const formats = options.formats ?? ['qr_code'];
	const Detector = detectorClass(env);
	if (Detector) {
		let usable: string[] = [];
		try {
			const supported = await Detector.getSupportedFormats();
			usable = formats.filter((format) => supported.includes(format));
		} catch {
			// A detector that can't say what it reads is skipped.
		}
		if (usable.length) {
			try {
				const found = await new Detector({ formats: usable }).detect(source);
				const first = found.find((code) => code.rawValue);
				if (first) return result(first.format, first.rawValue);
				// It looked for QR codes itself, so the fallback would find nothing more.
				if (usable.includes('qr_code')) return null;
			} catch {
				// Fall back to the bundled decoder below.
			}
		}
	}
	if (!formats.includes('qr_code')) return null;
	const text = await (env.decode ?? decodeInWorker)(await pixelsOf(source));
	return text === null ? null : result('qr_code', text);
}
