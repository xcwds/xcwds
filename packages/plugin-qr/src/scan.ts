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

/** An image to read: a file, a video frame (the viewfinder), a canvas or its pixels. */
export type ScanSource =
	Blob | ImageBitmap | HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas | ImageData;

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
	/** The longest side the bundled decoder reads at. Default `MAX_SIDE`. */
	maxSide?: number;
	env?: ScanEnv;
}

/** The longest side the fallback decodes at by default: plenty for a code, and quick. */
export const MAX_SIDE = 1024;

function detectorClass(env: ScanEnv): DetectorClass | undefined {
	if (env.BarcodeDetector !== undefined) return env.BarcodeDetector ?? undefined;
	return (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
}

/** The bundled decoder, with a Worker of its own that `close()` ends. */
export interface Decoder {
	decode(pixels: Pixels): Promise<string | null>;
	close(): void;
}

/**
 * Runs the bundled decoder in one Worker, started on first use and kept until `close()`. Where
 * the Worker can't start (offline before its file was ever fetched: service workers precache the
 * app's pages and chunks, not Vite's worker files), the decoder runs on the page instead.
 */
export function createDecoder(): Decoder {
	/** `undefined`: not started yet; `null`: closed, or it couldn't start. */
	let worker: Worker | null | undefined;
	let next = 0;
	const waiting = new Map<number, { resolve(text: string | null): void; reject(e: Error): void }>();
	const failAll = (error: Error) => {
		for (const w of waiting.values()) w.reject(error);
		waiting.clear();
	};
	function start(): Worker | null {
		try {
			const w = new Worker(new URL('./decode.worker.js', import.meta.url), { type: 'module' });
			w.onmessage = (event: MessageEvent<{ id: number; text: string | null }>) => {
				waiting.get(event.data.id)?.resolve(event.data.text);
				waiting.delete(event.data.id);
			};
			w.onerror = (event) => {
				event.preventDefault();
				w.terminate();
				if (worker === w) worker = null;
				failAll(new Error(event.message || 'The QR decoder could not start.'));
			};
			return w;
		} catch {
			return null;
		}
	}
	let closed = false;
	return {
		async decode(pixels) {
			if (closed) return null;
			if (worker === undefined) worker = start();
			const w = worker;
			if (w) {
				try {
					return await new Promise<string | null>((resolve, reject) => {
						const id = next++;
						waiting.set(id, { resolve, reject });
						// A copy goes over, so the page still has the pixels if the Worker fails.
						const data = pixels.data.slice();
						w.postMessage({ id, data, width: pixels.width, height: pixels.height }, [data.buffer]);
					});
				} catch {
					if (closed) return null;
				}
			}
			const { decodeQr } = await import('./decode.js');
			return decodeQr(pixels);
		},
		close() {
			closed = true;
			worker?.terminate();
			worker = null;
			for (const w of waiting.values()) w.resolve(null);
			waiting.clear();
		}
	};
}

const sizeOf = (image: object) =>
	'videoWidth' in image
		? {
				width: (image as HTMLVideoElement).videoWidth,
				height: (image as HTMLVideoElement).videoHeight
			}
		: (image as { width: number; height: number });

/** The image's pixels, at most `maxSide` on a side, upright as the photo was taken. */
async function pixelsOf(source: ScanSource, maxSide: number): Promise<Pixels> {
	const isData = typeof ImageData !== 'undefined' && source instanceof ImageData;
	if (isData && Math.max(source.width, source.height) <= maxSide) return source;
	// Files and large pixel arrays become a bitmap to draw smaller (files upright, as taken).
	const bitmap = source instanceof Blob || isData;
	const image = bitmap
		? await createImageBitmap(source as Blob | ImageData, { imageOrientation: 'from-image' })
		: source;
	const { width, height } = sizeOf(image);
	if (!width || !height) throw new Error('The image is empty.');
	const scale = Math.min(1, maxSide / Math.max(width, height));
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

/** Reads one image after another with the same detector and decoder, until `close()`. */
export interface Reader {
	/** The first code in `source`, or `null`. Rejects only when the image can't be read. */
	read(source: ScanSource): Promise<ScanResult | null>;
	close(): void;
}

/** A reader for many images, such as the viewfinder's frames: `<QrScanner>` uses one. */
export function createReader(options: ScanOptions = {}): Reader {
	const env = options.env ?? {};
	const formats = options.formats ?? ['qr_code'];
	const maxSide = options.maxSide ?? MAX_SIDE;
	const Detector = detectorClass(env);
	let decoder: Decoder | undefined;
	const decode = env.decode ?? ((pixels: Pixels) => (decoder ??= createDecoder()).decode(pixels));
	let detector: Promise<{ instance?: Detector; qr: boolean }> | undefined;
	const detecting = () =>
		(detector ??= (async () => {
			if (!Detector) return { qr: false };
			try {
				const supported = await Detector.getSupportedFormats();
				const usable = formats.filter((format) => supported.includes(format));
				if (!usable.length) return { qr: false };
				return { instance: new Detector({ formats: usable }), qr: usable.includes('qr_code') };
			} catch {
				// A detector that can't say what it reads is skipped.
				return { qr: false };
			}
		})());
	return {
		async read(source) {
			const { instance, qr } = await detecting();
			if (instance) {
				try {
					const found = await instance.detect(source);
					const first = found.find((code) => code.rawValue);
					if (first) return result(first.format, first.rawValue);
					// It looked for QR codes itself, so the fallback would find nothing more.
					if (qr) return null;
				} catch {
					// Fall back to the bundled decoder below.
				}
			}
			if (!formats.includes('qr_code')) return null;
			const text = await decode(await pixelsOf(source, maxSide));
			return text === null ? null : result('qr_code', text);
		},
		close() {
			decoder?.close();
		}
	};
}

/**
 * The first code found in `source`, or `null` when there's none. Rejects only when the image
 * itself can't be read.
 */
export async function scan(
	source: ScanSource,
	options: ScanOptions = {}
): Promise<ScanResult | null> {
	const reader = createReader(options);
	try {
		return await reader.read(source);
	} finally {
		reader.close();
	}
}
