// The ✅ cells of docs/camera.md (#143) for Chromium on a computer, checked with Playwright's
// fake camera and microphone: a smoke test of what @xcwds/plugin-camera and plugin-recorder rely
// on, not proof of what a real camera or microphone does. It runs on Linux, as CI does (Web Share
// and BarcodeDetector differ on other systems). When one of these changes, change its cell too.
// Firefox's cells are checked by e2e-firefox/ (`pnpm test:firefox`) with the same probes.
import { expect, test } from '@playwright/test';
import { serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';
import { probeCamera, probeRecorder } from './probes.js';

// A per-file `launchOptions` replaces the config's, so this repeats its Chromium and flag.
test.use({
	permissions: ['camera', 'microphone'],
	launchOptions: {
		executablePath: process.env.CHROMIUM_PATH || undefined,
		args: ['--disable-gpu', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
	}
});

const build = fileURLToPath(new URL('../build', import.meta.url));
let server: StaticServer;

test.beforeAll(async () => {
	server = await serveStatic(build);
});
test.afterAll(() => server.close());

test('Chromium has what the camera plugin uses, as docs/camera.md says', async ({ page }) => {
	// A page on the app's own origin: the camera needs a secure context, and localhost is one.
	await page.goto(server.url('/'));
	expect(await page.evaluate(probeCamera)).toEqual({
		plainSize: '640x480',
		largest: '3840x2160',
		constrained: true,
		facing: [],
		zoom: false,
		torch: false,
		focus: true,
		capture: true,
		photo: expect.stringMatching(/^image\//),
		frame: 3840,
		barcode: false,
		oriented: true,
		offscreen: true,
		jpeg: 'image/jpeg',
		webp: 'image/webp',
		persist: true,
		share: false
	});
});

test('Chromium has what the recorder plugin uses, as docs/camera.md says (#150)', async ({
	page
}) => {
	await page.goto(server.url('/'));
	expect(await page.evaluate(probeRecorder)).toEqual({
		processing: [false, false, false],
		webm: true,
		ogg: false,
		mp4: true,
		chunks: true,
		plays: true,
		playsWebm: 'probably',
		playsOgg: 'probably',
		wakeLock: true,
		locks: true,
		share: false
	});
});
