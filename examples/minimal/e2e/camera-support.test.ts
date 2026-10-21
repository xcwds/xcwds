// The ✅ cells of docs/camera.md (#143) for Chromium on a computer, checked with Playwright's
// fake camera and microphone: a smoke test of what @xcwds/plugin-camera and plugin-recorder rely
// on, not proof of what a real camera or microphone does. It runs on Linux, as CI does (Web Share
// and BarcodeDetector differ on other systems). When one of these changes, change its cell too.
import { expect, test } from '@playwright/test';
import { serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

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
	const found = await page.evaluate(async () => {
		const size = (track: MediaStreamTrack) => {
			const { width, height } = track.getSettings();
			return `${width}x${height}`;
		};
		const plain = await navigator.mediaDevices.getUserMedia({ video: true });
		const track = plain.getVideoTracks()[0]!;
		const caps = track.getCapabilities() as MediaTrackCapabilities & Record<string, unknown>;
		const constrained = typeof track.applyConstraints === 'function';
		const plainSize = size(track);
		track.stop();

		const large = await navigator.mediaDevices.getUserMedia({
			video: { width: { ideal: 4096 }, height: { ideal: 4096 } }
		});
		const big = large.getVideoTracks()[0]!;
		const largest = size(big);
		const capture = 'ImageCapture' in window;
		let photo = '';
		let frame = 0;
		if (capture) {
			// Not in TypeScript's DOM types.
			type Capture = {
				getPhotoCapabilities(): Promise<unknown>;
				takePhoto(): Promise<Blob>;
				grabFrame(): Promise<ImageBitmap>;
			};
			const { ImageCapture } = window as unknown as {
				ImageCapture: new (track: MediaStreamTrack) => Capture;
			};
			const camera = new ImageCapture(big);
			await camera.getPhotoCapabilities();
			photo = (await camera.takePhoto()).type;
			frame = (await camera.grabFrame()).width;
		}
		big.stop();

		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 4;
		const blobType = (type: string) =>
			new Promise<string | undefined>((done) => canvas.toBlob((blob) => done(blob?.type), type));
		let oriented = true;
		try {
			await createImageBitmap(canvas, { imageOrientation: 'from-image' });
		} catch {
			oriented = false;
		}
		return {
			plainSize,
			largest,
			constrained,
			facing: caps.facingMode ?? [],
			zoom: 'zoom' in caps,
			torch: 'torch' in caps,
			focus: 'focusMode' in caps && 'exposureMode' in caps,
			capture,
			photo,
			frame,
			barcode: 'BarcodeDetector' in window,
			oriented,
			offscreen: typeof OffscreenCanvas === 'function',
			jpeg: await blobType('image/jpeg'),
			webp: await blobType('image/webp'),
			persist: typeof navigator.storage.persist === 'function',
			share: typeof navigator.share === 'function'
		};
	});

	expect(found).toEqual({
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
	const found = await page.evaluate(async () => {
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
		});
		const track = stream.getAudioTracks()[0]!;
		const { echoCancellation, noiseSuppression, autoGainControl } = track.getSettings();
		const records = (type: string) => MediaRecorder.isTypeSupported(type);
		// Chunks every `timeslice`, joined into one file the page can play.
		const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
		const chunks: Blob[] = [];
		recorder.ondataavailable = (event) => chunks.push(event.data);
		recorder.start(250);
		await new Promise((done) => setTimeout(done, 1200));
		await new Promise((done) => {
			recorder.onstop = done;
			recorder.stop();
		});
		track.stop();
		const audio = new Audio(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })));
		const plays = await new Promise<boolean>((done) => {
			audio.onloadedmetadata = () => done(true);
			audio.onerror = () => done(false);
		});
		const canPlay = (type: string) => audio.canPlayType(type);
		return {
			processing: [echoCancellation, noiseSuppression, autoGainControl],
			webm: records('audio/webm;codecs=opus'),
			ogg: records('audio/ogg;codecs=opus'),
			mp4: records('audio/mp4'),
			chunks: chunks.length > 1,
			plays,
			playsWebm: canPlay('audio/webm; codecs="opus"'),
			playsOgg: canPlay('audio/ogg; codecs="opus"'),
			wakeLock: 'wakeLock' in navigator,
			locks: 'locks' in navigator,
			share: typeof navigator.share === 'function'
		};
	});

	expect(found).toEqual({
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
