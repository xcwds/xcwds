import { describe, expect, it, vi } from 'vitest';
import { MAX_SIDE, rectangle, type Quad } from './geometry.js';
import { applyFilter } from './filters.js';
import {
	answer,
	createProcessor,
	processPage,
	type ProcessRequest,
	type ProcessResponse,
	type WorkerLike
} from './process.js';
import { warp, type Pixels } from './warp.js';
import { ENCODE_ERROR, JPEG_QUALITY, encodeJpeg } from './encode.js';

// The real filters, watched, to see which pages skip them.
vi.mock('./filters.js', async (original) => {
	const actual = await original<typeof import('./filters.js')>();
	return { ...actual, applyFilter: vi.fn(actual.applyFilter) };
});

// Node has no canvas: a stand-in JPEG that says what it was made from.
vi.mock('./encode.js', async (original) => {
	const actual = await original<typeof import('./encode.js')>();
	return {
		...actual,
		encodeJpeg: vi.fn(
			async (page: Pixels, { quality = actual.JPEG_QUALITY }: { quality?: number } = {}) =>
				new Blob([`${page.width}x${page.height} at ${quality}`], { type: 'image/jpeg' })
		)
	};
});

function image(width: number, height: number, colour: (x: number, y: number) => number[]): Pixels {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) data.set(colour(x, y), (y * width + x) * 4);
	return { width, height, data };
}

/** A photo with a lighter, slightly tilted page on it, and the page's corners. */
const photo = image(60, 80, (x, y) =>
	x > 10 && x < 50 && y > 8 && y < 70 ? [230, 220, 210, 255] : [40, 60, 80, 255]
);
const corners: Quad = [
	{ x: 10, y: 8 },
	{ x: 50, y: 9 },
	{ x: 51, y: 70 },
	{ x: 11, y: 69 }
];

describe('processPage', () => {
	it('straightens the page to its own size and filters it', () => {
		const page = processPage(photo, corners, { filter: 'greyscale' });
		const straight = warp(photo, corners, { width: page.width, height: page.height });
		expect(page.data).toEqual(applyFilter(straight, 'greyscale').data);
		expect(page.width).toBeGreaterThanOrEqual(40);
		expect(page.height).toBeGreaterThanOrEqual(61);
	});

	it('keeps the photo as it is by default', () => {
		const page = processPage(photo, rectangle(60, 80), { max: 80 });
		expect(page).toMatchObject({ width: 60, height: 80, paper: null });
		expect(page.data).toEqual(photo.data);
		expect(page.data).not.toBe(photo.data);
	});

	it('snaps to a paper size and keeps to `max`', () => {
		const a4 = image(300, 424, () => [255, 255, 255, 255]);
		const page = processPage(a4, rectangle(300, 424), { max: 100, filter: 'bw' });
		expect(page.paper).toBe('a4');
		expect(Math.max(page.width, page.height)).toBe(100);
	});

	it('refuses corners that don’t make a page, an unknown filter and a bad `max`', () => {
		const [tl, tr, br, bl] = corners;
		expect(() => processPage(photo, [tl, br, tr, bl])).toThrow(RangeError);
		expect(() => processPage(photo, [tl, tr, br] as unknown as Quad)).toThrow(RangeError);
		expect(() => processPage(photo, [tl, tr, br, { x: NaN, y: 1 }])).toThrow(RangeError);
		expect(() => processPage(photo, corners, { filter: 'sepia' as 'bw' })).toThrow(RangeError);
		for (const max of [0, 1.5, MAX_SIDE + 1])
			expect(() => processPage(photo, corners, { max })).toThrow(RangeError);
		expect(() => processPage({ ...photo, width: 61 }, corners)).toThrow(RangeError);
		// Corners missing or not points, as a crop screen's state could hand over.
		const holed = Object.assign(new Array(4), { 0: tl, 1: tr, 3: bl });
		for (const quad of [null, [tl, tr, null, bl], holed, [tl, tr, br, bl, tl]])
			expect(() => processPage(photo, quad as unknown as Quad)).toThrow(RangeError);
		expect(() => processPage(null as unknown as Pixels, corners)).toThrow(RangeError);
	});

	it('keeps the warped pixels for Original rather than copying them', () => {
		vi.mocked(applyFilter).mockClear();
		const page = processPage(photo, corners);
		const straight = warp(photo, corners, { width: page.width, height: page.height });
		expect(page.data).toEqual(straight.data);
		expect(applyFilter).not.toHaveBeenCalled();
		processPage(photo, corners, { filter: 'greyscale' });
		expect(applyFilter).toHaveBeenCalledTimes(1);
	});
});

describe('answer', () => {
	it('answers with the page and hands its buffer back', async () => {
		const { response, transfer } = await answer({ id: 3, ...photo, quad: corners, filter: 'bw' });
		expect(response).toMatchObject({
			id: 3,
			ok: true,
			...processPage(photo, corners, { filter: 'bw' })
		});
		expect(response.ok && transfer).toEqual([response.ok && response.data.buffer]);
	});

	it('answers with the error’s message when the page can’t be made', async () => {
		const [tl, tr, br, bl] = corners;
		const { response, transfer } = await answer({ id: 4, ...photo, quad: [tl, br, tr, bl] });
		expect(response).toEqual({
			id: 4,
			ok: false,
			error: 'The corners don’t make a page: drag them to its corners.'
		});
		expect(transfer).toEqual([]);
	});

	it('encodes the page only when asked, and answers without a JPEG when it can’t', async () => {
		vi.mocked(encodeJpeg).mockClear();
		const plain = await answer({ id: 5, ...photo, quad: corners });
		expect(plain.response).not.toHaveProperty('jpeg');
		expect(encodeJpeg).not.toHaveBeenCalled();
		const { response } = await answer({ id: 6, ...photo, quad: corners, jpeg: 0.5 });
		const page = processPage(photo, corners);
		expect(response).toMatchObject({ id: 6, ok: true, ...page });
		expect(response.ok && (await response.jpeg?.text())).toBe(
			`${page.width}x${page.height} at 0.5`
		);
		vi.mocked(encodeJpeg).mockResolvedValueOnce(null);
		const none = await answer({ id: 7, ...photo, quad: corners, jpeg: 0.5 });
		expect(none.response).toMatchObject({ id: 7, ok: true });
		expect(none.response).not.toHaveProperty('jpeg');
		vi.mocked(encodeJpeg).mockRejectedValueOnce(new Error('out of memory'));
		const failed = await answer({ id: 8, ...photo, quad: corners, jpeg: 0.5 });
		expect(failed.response).toMatchObject({ id: 8, ok: true });
		expect(failed.response).not.toHaveProperty('jpeg');
	});
});

/** A Worker that runs `answer` as the real one does, structured-cloning both ways. */
class FakeWorker implements WorkerLike {
	onmessage: ((event: MessageEvent<ProcessResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	requests: ProcessRequest[] = [];
	terminated = false;
	/** Answer on its own, or wait for `reply()`/`fail()`. */
	constructor(private auto = true) {}
	postMessage(message: ProcessRequest, transfer: Transferable[]) {
		const request = structuredClone(message, { transfer });
		this.requests.push(request);
		if (this.auto) setTimeout(() => this.reply(request));
	}
	async reply(request = this.requests.at(-1)!) {
		if (this.terminated) return;
		const { response, transfer } = await answer(request);
		if (this.terminated) return;
		this.onmessage?.({ data: structuredClone(response, { transfer }) } as MessageEvent);
	}
	fail() {
		this.onerror?.({ message: 'boom', preventDefault() {} } as ErrorEvent);
	}
	terminate() {
		this.terminated = true;
	}
}

describe('createProcessor', () => {
	it('processes pages in one Worker, started on first use, and keeps the source', async () => {
		const worker = new FakeWorker();
		const start = vi.fn(() => worker);
		const processor = createProcessor({ worker: start });
		expect(start).not.toHaveBeenCalled();
		const before = photo.data.slice();
		const first = await processor.process(photo, corners, { filter: 'greyscale' });
		const second = await processor.process(photo, rectangle(60, 80), { max: 40 });
		expect(start).toHaveBeenCalledTimes(1);
		expect(first).toEqual(processPage(photo, corners, { filter: 'greyscale' }));
		expect(second).toEqual(processPage(photo, rectangle(60, 80), { max: 40 }));
		expect(worker.requests.map((r) => r.id)).toEqual([0, 1]);
		// The photo was copied over, not handed over.
		expect(photo.data.byteLength).toBe(before.byteLength);
		expect(photo.data).toEqual(before);
		processor.close();
		expect(worker.terminated).toBe(true);
	});

	it('matches each answer to its page when they come back out of order', async () => {
		const worker = new FakeWorker(false);
		const processor = createProcessor({ worker: () => worker });
		const a = processor.process(photo, corners);
		const b = processor.process(photo, corners, { filter: 'bw' });
		await worker.reply(worker.requests[1]);
		await worker.reply(worker.requests[0]);
		expect((await a).data).toEqual(processPage(photo, corners).data);
		expect((await b).data).toEqual(processPage(photo, corners, { filter: 'bw' }).data);
	});

	it('rejects with a RangeError when the Worker can’t make the page', async () => {
		const processor = createProcessor({ worker: () => new FakeWorker() });
		const [tl, tr, br, bl] = corners;
		await expect(processor.process(photo, [tl, br, tr, bl])).rejects.toThrow(RangeError);
		// The Worker is still there for the next page.
		await expect(processor.process(photo, corners)).resolves.toMatchObject({ paper: null });
	});

	it('refuses a bad request on the page, before starting or sending anything', async () => {
		const worker = new FakeWorker(false);
		const start = vi.fn(() => worker);
		const processor = createProcessor({ worker: start });
		const [tl, tr, , bl] = corners;
		for (const [source, quad, options] of [
			[photo, [tl, tr, null, bl]],
			[photo, null],
			[photo, corners, { max: 0 }],
			[photo, corners, { filter: 'sepia' }],
			[{ ...photo, height: 3 }, corners]
		] as [Pixels, Quad, object?][])
			await expect(processor.process(source, quad, options)).rejects.toThrow(RangeError);
		expect(start).not.toHaveBeenCalled();
		const page = processor.process(photo, corners);
		expect(worker.requests.map((r) => r.id)).toEqual([0]);
		await worker.reply();
		await expect(page).resolves.toEqual(processPage(photo, corners));
	});

	it('processes on the page when the Worker can’t start', async () => {
		for (const start of [
			() => null,
			() => {
				throw new Error('CSP');
			}
		]) {
			const processor = createProcessor({ worker: start });
			expect(await processor.process(photo, corners)).toEqual(processPage(photo, corners));
			const [tl, tr, br, bl] = corners;
			await expect(processor.process(photo, [tl, br, tr, bl])).rejects.toThrow(RangeError);
		}
	});

	it('finishes on the page, and stays there, when the Worker fails', async () => {
		const worker = new FakeWorker(false);
		const start = vi.fn(() => worker);
		const processor = createProcessor({ worker: start });
		const waiting = processor.process(photo, corners, { filter: 'bw' });
		worker.fail();
		expect(worker.terminated).toBe(true);
		expect(await waiting).toEqual(processPage(photo, corners, { filter: 'bw' }));
		expect(await processor.process(photo, corners)).toEqual(processPage(photo, corners));
		expect(start).toHaveBeenCalledTimes(1);
		expect(worker.requests).toHaveLength(1);
	});

	it('processes on the page when the photo can’t be sent', async () => {
		const worker = new FakeWorker();
		worker.postMessage = () => {
			throw new DOMException('no', 'DataCloneError');
		};
		const processor = createProcessor({ worker: () => worker });
		expect(await processor.process(photo, corners)).toEqual(processPage(photo, corners));
	});

	it('rejects what’s waiting, and anything after, once closed', async () => {
		const worker = new FakeWorker(false);
		const processor = createProcessor({ worker: () => worker });
		const waiting = processor.process(photo, corners);
		processor.close();
		await expect(waiting).rejects.toThrow('closed');
		await worker.reply(worker.requests[0]);
		await expect(processor.process(photo, corners)).rejects.toThrow('closed');
		expect(worker.requests).toHaveLength(1);
	});
});

describe('finish', () => {
	const text = (page: { width: number; height: number }, quality = JPEG_QUALITY) =>
		`${page.width}x${page.height} at ${quality}`;

	it('makes the page and its JPEG in the Worker, ready for the pages store', async () => {
		vi.mocked(encodeJpeg).mockClear();
		const worker = new FakeWorker();
		const processor = createProcessor({ worker: () => worker });
		const page = processPage(photo, corners, { filter: 'greyscale' });
		const done = await processor.finish(photo, corners, { filter: 'greyscale', quality: 0.6 });
		expect(done).toEqual({
			blob: expect.any(Blob),
			width: page.width,
			height: page.height,
			filter: 'greyscale',
			paper: null
		});
		expect(await done.blob.text()).toBe(text(page, 0.6));
		expect(worker.requests[0]).toMatchObject({ filter: 'greyscale', jpeg: 0.6 });
		// Encoded once, in the Worker.
		expect(encodeJpeg).toHaveBeenCalledTimes(1);
		const plain = await processor.finish(photo, corners);
		expect(plain.filter).toBe('original');
		expect(await plain.blob.text()).toBe(text(page));
		expect(worker.requests[1]).toMatchObject({ jpeg: JPEG_QUALITY });
		// `process` asks for no JPEG and gives none.
		const processed = await processor.process(photo, corners);
		expect(worker.requests[2]).not.toHaveProperty('jpeg');
		expect(processed).not.toHaveProperty('jpeg');
	});

	it('encodes on the page when the Worker couldn’t', async () => {
		vi.mocked(encodeJpeg).mockClear();
		vi.mocked(encodeJpeg).mockResolvedValueOnce(null);
		const processor = createProcessor({ worker: () => new FakeWorker() });
		const done = await processor.finish(photo, corners, { quality: 0.4 });
		expect(await done.blob.text()).toBe(text(done, 0.4));
		expect(encodeJpeg).toHaveBeenCalledTimes(2);
	});

	it('makes and encodes the page on the page when the Worker can’t start', async () => {
		const processor = createProcessor({ worker: () => null });
		const done = await processor.finish(photo, corners, { filter: 'bw' });
		const page = processPage(photo, corners, { filter: 'bw' });
		expect(done).toMatchObject({ width: page.width, height: page.height, filter: 'bw' });
		expect(await done.blob.text()).toBe(text(page));
	});

	it('rejects when no JPEG can be made anywhere', async () => {
		vi.mocked(encodeJpeg).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
		const processor = createProcessor({ worker: () => new FakeWorker() });
		await expect(processor.finish(photo, corners)).rejects.toThrow(ENCODE_ERROR);
		// The next page is fine.
		await expect(processor.finish(photo, corners)).resolves.toHaveProperty('blob');
	});

	it('refuses a bad quality, or a bad page, before starting anything', async () => {
		const start = vi.fn(() => new FakeWorker());
		const processor = createProcessor({ worker: start });
		for (const quality of [-1, 1.5, NaN])
			await expect(processor.finish(photo, corners, { quality })).rejects.toThrow(RangeError);
		await expect(processor.finish(photo, corners, { max: 0 })).rejects.toThrow(RangeError);
		expect(start).not.toHaveBeenCalled();
	});

	it('rejects once closed, even while the page is being encoded here', async () => {
		let encoded!: (blob: Blob) => void;
		vi.mocked(encodeJpeg).mockReturnValueOnce(new Promise((resolve) => (encoded = resolve)));
		const processor = createProcessor({ worker: () => null });
		const waiting = processor.finish(photo, corners);
		await vi.waitFor(() => expect(encoded).toBeDefined());
		processor.close();
		encoded(new Blob(['x'], { type: 'image/jpeg' }));
		await expect(waiting).rejects.toThrow('closed');
		await expect(processor.finish(photo, corners)).rejects.toThrow('closed');
	});
});
