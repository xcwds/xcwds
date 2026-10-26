/**
 * `@xcwds/plugin-scanner/process`: turn a photo and the page's corners into the finished page,
 * straightened and filtered. `processPage` does it where it's called; `createProcessor()` does it
 * in a Worker, so a 12-megapixel photo never holds up the page, and on the page where a Worker
 * can't start. Safe to import during prerender: browser APIs are reached only when a page is
 * processed.
 */
import { MAX_SIDE, isConvex, pageSize, type Paper, type Quad } from './geometry.js';
import { FILTERS, applyFilter, type Filter } from './filters.js';
import { warp, type Pixels } from './warp.js';

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
	{ filter = 'original', max = MAX_SIDE }: ProcessOptions = {}
): ProcessedPage {
	if (!FILTERS.includes(filter)) throw new RangeError(`The filter must be ${FILTERS.join(', ')}.`);
	if (!Number.isInteger(max) || max < 1 || max > MAX_SIDE)
		throw new RangeError(`The page's longest side must be 1 to ${MAX_SIDE} pixels.`);
	if (
		!Array.isArray(quad) ||
		quad.length !== 4 ||
		!quad.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) ||
		!isConvex(quad)
	)
		throw new RangeError('The corners don’t make a page: drag them to its corners.');
	const { width, height, paper } = pageSize(quad, { max });
	const page = applyFilter(warp(source, quad, { width, height }), filter);
	return { ...page, paper };
}

/** What the page sends the Worker. */
export interface ProcessRequest extends Pixels {
	id: number;
	quad: Quad;
	filter?: Filter;
	max?: number;
}

/** What the Worker answers. */
export type ProcessResponse =
	({ id: number; ok: true } & ProcessedPage) | { id: number; ok: false; error: string };

/**
 * The Worker's answer to `request`, with the buffers to transfer back. The Worker
 * (`process.worker.ts`) is only this; tests call it directly.
 */
export function answer(request: ProcessRequest): {
	response: ProcessResponse;
	transfer: ArrayBuffer[];
} {
	const { id, quad, filter, max } = request;
	try {
		const page = processPage(request, quad, { filter, max });
		return {
			response: { id, ok: true, ...page },
			transfer: [page.data.buffer as ArrayBuffer]
		};
	} catch (e) {
		const error = e instanceof Error ? e.message : 'The page couldn’t be processed.';
		return { response: { id, ok: false, error }, transfer: [] };
	}
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
	close(): void;
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
	const waiting = new Map<
		number,
		{ resolve(page: ProcessedPage): void; reject(e: Error): void; fallback(): void }
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
				const { width, height, data, paper } = response;
				job.resolve({ width, height, data, paper });
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

	return {
		process(source, quad, opts = {}) {
			if (closed) return Promise.reject(new Error(CLOSED));
			if (worker === undefined) worker = launch();
			const w = worker;
			if (!w) return onPage(source, quad, opts);
			return new Promise<ProcessedPage>((resolve, reject) => {
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
					max: opts.max
				};
				try {
					w.postMessage(request, [data.buffer]);
				} catch {
					waiting.delete(id);
					onPage(source, quad, opts).then(resolve, reject);
				}
			});
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
