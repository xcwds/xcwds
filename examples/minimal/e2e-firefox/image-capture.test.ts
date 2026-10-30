// What Firefox's `dom.imagecapture.enabled` (off by default) turns on today, for docs/camera.md
// (#143): an older draft of ImageCapture, where `takePhoto()` returns nothing and sends the photo
// in a `photo` event, with no `grabFrame` or `getPhotoCapabilities`. The camera plugin's
// `capture()` gets no Blob from it and takes the viewfinder's frame instead.
import { expect, test } from '@playwright/test';
import { serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

// A per-file `launchOptions` replaces the config's, so this repeats its Firefox and prefs.
test.use({
	launchOptions: {
		executablePath: process.env.FIREFOX_PATH || undefined,
		firefoxUserPrefs: {
			'media.navigator.streams.fake': true,
			'media.navigator.permission.disabled': true,
			'dom.imagecapture.enabled': true
		}
	}
});

const build = fileURLToPath(new URL('../build', import.meta.url));
let server: StaticServer;

test.beforeAll(async () => {
	server = await serveStatic(build);
});
test.afterAll(() => server.close());

test('dom.imagecapture.enabled gives Firefox only an old-draft ImageCapture', async ({ page }) => {
	await page.goto(server.url('/'));
	const found = await page.evaluate(async () => {
		const stream = await navigator.mediaDevices.getUserMedia({ video: true });
		const track = stream.getVideoTracks()[0]!;
		type Capture = EventTarget & Record<string, unknown> & { takePhoto(): unknown };
		const { ImageCapture } = window as unknown as {
			ImageCapture: new (track: MediaStreamTrack) => Capture;
		};
		const camera = new ImageCapture(track);
		const photo = new Promise<string>((done) =>
			camera.addEventListener('photo', (event) => done((event as BlobEvent).data.type))
		);
		const returned = camera.takePhoto();
		const result = {
			returned: returned === undefined ? 'nothing' : typeof returned,
			photo: await photo,
			grabFrame: typeof camera.grabFrame,
			getPhotoCapabilities: typeof camera.getPhotoCapabilities
		};
		track.stop();
		return result;
	});
	expect(found).toEqual({
		returned: 'nothing',
		photo: 'image/jpeg',
		grabFrame: 'undefined',
		getPhotoCapabilities: 'undefined'
	});
});
