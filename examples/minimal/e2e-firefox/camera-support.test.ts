// The ✅ cells of docs/camera.md (#143) for Firefox on a computer: the probes of
// e2e/camera-support.test.ts in Firefox, with its fake camera and microphone. As there, a smoke
// test of what the plugins rely on, not proof of what a real camera does. Run it with
// `pnpm test:firefox`; when one of these changes, change its cell too.
import { expect, test } from '@playwright/test';
import { serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';
import { probeCamera, probeRecorder } from '../e2e/probes.js';

const build = fileURLToPath(new URL('../build', import.meta.url));
let server: StaticServer;

test.beforeAll(async () => {
	server = await serveStatic(build);
});
test.afterAll(() => server.close());

test('Firefox has what the camera plugin uses, as docs/camera.md says', async ({ page }) => {
	await page.goto(server.url('/'));
	expect(await page.evaluate(probeCamera)).toEqual({
		plainSize: '640x480',
		largest: '4096x2160',
		constrained: true,
		facing: ['environment'],
		zoom: false,
		torch: false,
		focus: false,
		capture: false,
		photo: '',
		frame: 0,
		barcode: false,
		oriented: true,
		offscreen: true,
		jpeg: 'image/jpeg',
		webp: 'image/webp',
		persist: true,
		share: false
	});
});

test('Firefox has what the recorder plugin uses, as docs/camera.md says (#150)', async ({
	page
}) => {
	await page.goto(server.url('/'));
	expect(await page.evaluate(probeRecorder)).toEqual({
		processing: [false, false, false],
		webm: true,
		ogg: true,
		mp4: false,
		chunks: true,
		plays: true,
		playsWebm: 'probably',
		playsOgg: 'probably',
		wakeLock: true,
		locks: true,
		share: false
	});
});
