// @xcwds/plugin-scanner's GPU warp (#151) on a real WebGL 2 context: `warpGl` must give the page
// `warp` gives, to within a shade, on the page and in a Worker (where the scanner runs it), on a
// `<canvas>` and an `OffscreenCanvas`, and across strips. It loads the package's built modules
// as they are, since the example app only reaches them through the processing Worker. Headless
// Chromium draws WebGL in software (SwiftShader), even with `--disable-gpu`.
import { expect, test, type Page } from '@playwright/test';
import { serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

test.use({
	launchOptions: {
		executablePath: process.env.CHROMIUM_PATH || undefined,
		args: ['--disable-gpu']
	}
});

const dist = fileURLToPath(new URL('../../../packages/plugin-scanner/dist', import.meta.url));
let server: StaticServer;

test.beforeAll(async () => {
	server = await serveStatic(dist);
});
test.afterAll(() => server.close());

interface Case {
	photo: { width: number; height: number };
	quad: { x: number; y: number }[];
	size: { width: number; height: number };
	canvas: 'offscreen' | 'element';
}

/**
 * Runs in the browser (on the page, or in a module Worker): warps a seeded random photo both ways
 * and says how far apart they are. Kept free of outside names, since it's sent as source text.
 */
async function compare(base: string, c: Case) {
	const { warp } = await import(`${base}/warp.js`);
	const { warpGl } = await import(`${base}/warp-gl.js`);
	const { width, height } = c.photo;
	const data = new Uint8ClampedArray(width * height * 4);
	let seed = 151;
	for (let i = 0; i < data.length; i++) {
		seed = (seed * 1103515245 + 12345) >>> 0;
		// See-through pixels too, which must come out as they went in (no premultiplying).
		data[i] = i % 4 === 3 && i % 3 ? 255 : seed >>> 24;
	}
	const photo = { width, height, data };
	const canvas =
		c.canvas === 'element'
			? () => document.createElement('canvas')
			: () => new OffscreenCanvas(1, 1);
	const started = performance.now();
	const gpu = warpGl(photo, c.quad, c.size, { canvas });
	const took = performance.now() - started;
	if (!gpu) return { ok: false as const };
	const cpu = warp(photo, c.quad, c.size);
	let worst = 0;
	let off = 0;
	for (let i = 0; i < cpu.data.length; i++) {
		const d = Math.abs(cpu.data[i] - gpu.data[i]);
		if (d > worst) worst = d;
		if (d > 0) off++;
	}
	return {
		ok: true as const,
		width: gpu.width,
		height: gpu.height,
		worst,
		off: off / cpu.data.length,
		took
	};
}

const perspective: Case = {
	photo: { width: 640, height: 480 },
	// A page in perspective with its top left corner off the photo, so edges get clamped.
	quad: [
		{ x: -20.5, y: 30.25 },
		{ x: 600, y: 10 },
		{ x: 630.75, y: 470 },
		{ x: 40, y: 420.5 }
	],
	size: { width: 500, height: 707 },
	canvas: 'offscreen'
};

/** A page taller than one strip (4096 wide: 1024 rows a strip). */
const strips: Case = {
	photo: { width: 1200, height: 900 },
	quad: [
		{ x: 100, y: 50 },
		{ x: 1150, y: 80 },
		{ x: 1100, y: 880 },
		{ x: 60, y: 850 }
	],
	size: { width: 4096, height: 2900 },
	canvas: 'offscreen'
};

/** The photo itself at its own size, which `warp` copies unchanged. */
const copy: Case = {
	photo: { width: 33, height: 17 },
	quad: [
		{ x: 0, y: 0 },
		{ x: 33, y: 0 },
		{ x: 33, y: 17 },
		{ x: 0, y: 17 }
	],
	size: { width: 33, height: 17 },
	canvas: 'element'
};

/** `compare` on the page: it goes over as source text, as functions do. */
const onPage = (page: Page, base: string, c: Case) =>
	page.evaluate(([b, k, fn]) => (new Function(`return ${fn}`)() as typeof compare)(b, k), [
		base,
		c,
		compare.toString()
	] as const);

test('gives the page warp gives, on the page', async ({ page }) => {
	await page.goto(server.url('/warp-gl.js'));
	const base = server.url('').replace(/\/$/, '');
	for (const c of [perspective, { ...perspective, canvas: 'element' as const }, strips, copy]) {
		const result = await onPage(page, base, c);
		expect(result, JSON.stringify(c.size)).toMatchObject({ ok: true, ...c.size });
		// Rounding apart, the same page: float32 on the GPU, float64 in JavaScript.
		expect(result.ok && result.worst).toBeLessThanOrEqual(1);
		expect(result.ok && result.off).toBeLessThan(0.01);
	}
	const exact = await onPage(page, base, copy);
	expect(exact.ok && exact.worst).toBe(0);
});

test('gives the page warp gives, in a Worker', async ({ page }) => {
	await page.goto(server.url('/warp-gl.js'));
	const base = server.url('').replace(/\/$/, '');
	for (const c of [perspective, strips]) {
		const result = await page.evaluate(
			([b, k, fn]) =>
				new Promise((resolve, reject) => {
					const source = `const compare = ${fn};
						self.onmessage = (e) => compare(...e.data).then((r) => postMessage(r), (e) => postMessage({ error: String(e) }));`;
					const worker = new Worker(
						URL.createObjectURL(new Blob([source], { type: 'text/javascript' })),
						{ type: 'module' }
					);
					worker.onmessage = (e) => resolve(e.data);
					worker.onerror = (e) => reject(new Error(e.message));
					worker.postMessage([b, k]);
				}),
			[base, c, compare.toString()] as const
		);
		expect(result, JSON.stringify(c.size)).toMatchObject({ ok: true, ...c.size });
		const { worst, off } = result as { worst: number; off: number };
		expect(worst).toBeLessThanOrEqual(1);
		expect(off).toBeLessThan(0.01);
	}
});
