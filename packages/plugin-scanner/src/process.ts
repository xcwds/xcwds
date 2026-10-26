/**
 * `@xcwds/plugin-scanner/process`: turn a photo and the page's corners into the finished page,
 * straightened and filtered. `processPage` does it where it's called; `createProcessor()` does it
 * in a Worker, so a 12-megapixel photo never holds up the page, and on the page where a Worker
 * can't start. Its `finish` also encodes the page as the JPEG the pages store keeps. Safe to
 * import during prerender: browser APIs are reached only when a page is processed.
 */
import {
	MAX_SIDE,
	isConvex,
	pageSize,
	type PageSize,
	type Paper,
	type Point,
	type Quad
} from './geometry.js';
import { FILTERS, applyFilter, type Filter } from './filters.js';
import { warp, type Pixels } from './warp.js';
import { ENCODE_ERROR, encodeJpeg, jpegQuality, type EncodeOptions } from './encode.js';

export interface ProcessOptions {
	/** Default `original`. */
	filter?: Filter;
	/** The longest side of the finished page, in pixels. Default and most `MAX_SIDE`. */
	max?: number;
}

/** A finished page's pixels, and the paper size its shape was snapped to, if any. */
export interface ProcessedPage extends Pixels {
	paper: Paper | null;
}

/**
 * The part of `source` inside `quad` (its corners clockwise from the top left, in `source`'s
 * pixels), straightened to the size `pageSize` gives it and passed through `filter`. Throws a
 * `RangeError` for corners that don't make a page (not convex, or not numbers), an unknown
 * filter, a `max` that isn't a whole number from 1 to `MAX_SIDE`, or pixels that don't match
 * their size.
 */
export function processPage(
	source: Pixels,
	quad: Quad,
	options: ProcessOptions = {}
): ProcessedPage {
	const { width, height, paper, filter } = pagePlan(source, quad, options);
	const straight = warp(source, quad, { width, height });
	// Original keeps the warped pixels: `applyFilter` would copy a page of up to MAX_SIDE².
	const page = filter === 'original' ? straight : applyFilter(straight, filter);
	return { ...page, paper };
}

/**
 * The checks `processPage` makes, and the page's size and filter. Cheap, so the processor runs
 * them on the page before copying a photo to the Worker.
 */
function pagePlan(
	source: Pixels,
	quad: Quad,
	{ filter = 'original', max = MAX_SIDE }: ProcessOptions
): PageSize & { filter: Filter } {
	if (!FILTERS.includes(filter)) throw new RangeError(`The filter must be ${FILTERS.join(', ')}.`);
	if (!Number.isInteger(max) || max < 1 || max > MAX_SIDE)
		throw new RangeError(`The page's longest side must be 1 to ${MAX_SIDE} pixels.`);
	// Spread, so a hole in the array counts as a missing corner.
	const points: unknown[] = Array.isArray(quad) ? [...quad] : [];
	if (
		points.length !== 4 ||
		!points.every((p) => Number.isFinite((p as Point)?.x) && Number.isFinite((p as Point)?.y)) ||
		!isConvex(quad)
	)
		throw new RangeError('The corners don’t make a page: drag them to its corners.');
	if (
		!source ||
		!Number.isInteger(source.width) ||
		!Number.isInteger(source.height) ||
		source.width < 1 ||
		source.height < 1 ||
		!(source.data instanceof Uint8ClampedArray) ||
		source.data.length !== source.width * source.height * 4
	)
		throw new RangeError('The source pixels don’t match its width and height.');
	return { ...pageSize(quad, { max }), filter };
}

/** What the page sends the Worker. */
export interface ProcessRequest extends Pixels {
	id: number;
	quad: Quad;
	filter?: Filter;
	max?: number;
	/** Also encode the page as a JPEG, at this quality. */
	jpeg?: number;
}

/**
 * What the Worker answers. `jpeg` is there when it was asked for and the Worker could encode it
 * (it has an `OffscreenCanvas`); otherwise the page encodes the pixels itself.
 */
export type ProcessResponse =
	| ({ id: number; ok: true; jpeg?: Blob } & ProcessedPage)
	| { id: number; ok: false; error: string };

/**
 * The Worker's answer to `request`, with the buffers to transfer back. The Worker
 * (`process.worker.ts`) is only this; tests call it directly.
 */
export async function answer(request: ProcessRequest): Promise<{
	response: ProcessResponse;
	transfer: ArrayBuffer[];
}> {
	const { id, quad, filter, max, jpeg: quality } = request;
	let page: ProcessedPage;
	try {
		page = processPage(request, quad, { filter, max });
	} catch (e) {
		const error = e instanceof Error ? e.message : 'The page couldn’t be processed.';
		return { response: { id, ok: false, error }, transfer: [] };
	}
	let jpeg: Blob | null = null;
	if (quality !== undefined) jpeg = await encodeJpeg(page, { quality }).catch(() => null);
	return {
		response: { id, ok: true, ...page, ...(jpeg ? { jpeg } : {}) },
		transfer: [page.data.buffer as ArrayBuffer]
	};
}

/** The part of a Worker the processor uses, so tests can pass a stand-in. */
export interface WorkerLike {
	postMessage(message: ProcessRequest, transfer: Transferable[]): void;
	onmessage: ((event: MessageEvent<ProcessResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	terminate(): void;
}

export interface ProcessorOptions {
	/**
	 * Starts the Worker; `null` (or a throw) runs pages on the page instead. The default starts
	 * `process.worker.js` as a module Worker.
	 */
	worker?: () => WorkerLike | null;
}

/** Processes one page after another in the same Worker, until `close()`. */
export interface Processor {
	/**
	 * `processPage(source, quad, options)` in the Worker. `source` is copied over, so it stays
	 * usable (for another crop). Rejects with a `RangeError` as `processPage` throws, and with
	 * an `Error` once the processor is closed.
	 */
	process(source: Pixels, quad: Quad, options?: ProcessOptions): Promise<ProcessedPage>;
	/**
	 * `process`, then the page as a JPEG at `quality` (default `JPEG_QUALITY`), ready for the
	 * pages store's `add` or `retake`. Encoded in the Worker where it has an `OffscreenCanvas`,
	 * else on the page. Rejects as `process` does, with a `RangeError` for a bad `quality`, and
	 * with an `Error` (`ENCODE_ERROR`) when the browser can't make a JPEG of it.
	 */
	finish(
		source: Pixels,
		quad: Quad,
		options?: ProcessOptions & EncodeOptions
	): Promise<FinishedPage>;
	close(): void;
}

/** A finished page as the pages store takes it, and the paper size its shape was snapped to. */
export interface FinishedPage {
	blob: Blob;
	width: number;
	height: number;
	filter: Filter;
	paper: Paper | null;
}

const CLOSED = 'The scanner was closed before the page was ready.';

const startWorker = (): WorkerLike =>
	new Worker(new URL('./process.worker.js', import.meta.url), { type: 'module' }) as WorkerLike;

/**
 * Runs `processPage` in one Worker, started on first use and kept until `close()`. Where the
 * Worker can't start or stops working (offline before its file was ever fetched: service workers
 * precache the app's pages and chunks, not Vite's worker files), pages are processed on the page
 * instead.
 */
export function createProcessor(options: ProcessorOptions = {}): Processor {
	const start = options.worker ?? startWorker;
	/** `undefined`: not started yet; `null`: closed, or it couldn't start. */
	let worker: WorkerLike | null | undefined;
	let closed = false;
	let next = 0;
	type Done = ProcessedPage & { jpeg?: Blob };
	const waiting = new Map<
		number,
		{ resolve(page: Done): void; reject(e: Error): void; fallback(): void }
	>();

	function launch(): WorkerLike | null {
		let w: WorkerLike | null;
		try {
			w = start();
		} catch {
			return null;
		}
		if (!w) return null;
		const started = w;
		started.onmessage = (event) => {
			const response = event.data;
			const job = waiting.get(response.id);
			if (!job) return;
			waiting.delete(response.id);
			if (response.ok) {
				const { width, height, data, paper, jpeg } = response;
				job.resolve({ width, height, data, paper, ...(jpeg ? { jpeg } : {}) });
			} else job.reject(new RangeError(response.error));
		};
		started.onerror = (event) => {
			event.preventDefault();
			started.terminate();
			if (worker === started) worker = null;
			// Whatever it was working on is done on the page instead.
			const jobs = [...waiting.values()];
			waiting.clear();
			for (const job of jobs) job.fallback();
		};
		return started;
	}

	const onPage = (source: Pixels, quad: Quad, opts: ProcessOptions) =>
		new Promise<ProcessedPage>((resolve) => resolve(processPage(source, quad, opts)));

	/** `process`, with the Worker also encoding a JPEG at `quality` when it's given. */
	function run(source: Pixels, quad: Quad, opts: ProcessOptions, quality?: number): Promise<Done> {
		if (closed) return Promise.reject(new Error(CLOSED));
		// A bad request is refused here, before the photo is copied or anything waits on it.
		try {
			pagePlan(source, quad, opts);
		} catch (e) {
			return Promise.reject(e as Error);
		}
		if (worker === undefined) worker = launch();
		const w = worker;
		if (!w) return onPage(source, quad, opts);
		return new Promise<Done>((resolve, reject) => {
			const id = next++;
			waiting.set(id, {
				resolve,
				reject,
				fallback: () => {
					if (closed) reject(new Error(CLOSED));
					else onPage(source, quad, opts).then(resolve, reject);
				}
			});
			// A copy goes over, so the page keeps its pixels for another crop or if the Worker fails.
			const data = source.data.slice();
			const request: ProcessRequest = {
				id,
				width: source.width,
				height: source.height,
				data,
				quad: quad.map(({ x, y }) => ({ x, y })) as unknown as Quad,
				filter: opts.filter,
				max: opts.max,
				...(quality === undefined ? {} : { jpeg: quality })
			};
			try {
				w.postMessage(request, [data.buffer]);
			} catch {
				waiting.delete(id);
				onPage(source, quad, opts).then(resolve, reject);
			}
		});
	}

	return {
		async process(source, quad, opts = {}) {
			const { width, height, data, paper } = await run(source, quad, opts);
			return { width, height, data, paper };
		},
		async finish(source, quad, opts = {}) {
			const quality = jpegQuality(opts.quality);
			const page = await run(source, quad, opts, quality);
			// The Worker had no OffscreenCanvas, or the page was made here: encode it here.
			const blob = page.jpeg ?? (await encodeJpeg(page, { quality }));
			if (closed) throw new Error(CLOSED);
			if (!blob) throw new Error(ENCODE_ERROR);
			const { width, height, paper } = page;
			return { blob, width, height, filter: opts.filter ?? 'original', paper };
		},
		close() {
			closed = true;
			worker?.terminate();
			worker = null;
			const jobs = [...waiting.values()];
			waiting.clear();
			for (const job of jobs) job.reject(new Error(CLOSED));
		}
	};
}
