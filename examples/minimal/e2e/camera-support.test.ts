// The ✅ cells of docs/camera.md (#143) for Chromium on a computer, checked with Playwright's
// fake camera and microphone: a smoke test of what @xcwds/plugin-camera and plugin-recorder rely
// on, not proof of what a real camera or microphone does. It runs on Linux, as CI does (Web Share
// and BarcodeDetector differ on other systems). When one of these changes, change its cell too.
// Firefox's cells are checked by e2e-firefox/ (`pnpm test:firefox`) with the same probes.
import { expect, test } from '@playwright/test';
import { serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';
import { probeCamera, probePtz, probeRecorder } from './probes.js';

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
		ptz: [],
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
		persist: 'refused, denied',
		share: false
	});
});

test('Chromium reports pan, tilt and zoom only with their permission, as docs/camera.md says', async ({
	page,
	context
}) => {
	await page.goto(server.url('/'));
	// Without the pan-tilt-zoom permission, asking for them changes nothing.
	expect(await page.evaluate(probePtz)).toEqual({ permission: 'denied', controls: [] });
	// Playwright has no name for that permission, so grant it over CDP, in this context.
	const cdp = await context.newCDPSession(page);
	const { targetInfo } = await cdp.send('Target.getTargetInfo');
	await cdp.send('Browser.setPermission', {
		browserContextId: targetInfo.browserContextId,
		origin: new URL(server.url('/')).origin,
		permission: { name: 'camera', panTiltZoom: true },
		setting: 'granted'
	});
	expect(await page.evaluate(probePtz)).toEqual({
		permission: 'granted',
		controls: ['zoom', 'pan', 'tilt']
	});
	// The permission is what counts: a stream that doesn't ask for them reports them too.
	expect((await page.evaluate(probeCamera)).ptz).toEqual(['zoom', 'pan', 'tilt']);
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
		playsMp4Aac: 'probably',
		wakeLock: true,
		locks: true,
		share: false
	});
});
