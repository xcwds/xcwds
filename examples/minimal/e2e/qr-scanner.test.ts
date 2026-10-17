// @xcwds/plugin-qr's live `<QrScanner>` (#147) on /utils/qr, with Chromium's fake camera playing a
// QR code (a Y4M video written here from the plugin's own encoder).
import { expect, test } from '@playwright/test';
import { encodeQr } from '@xcwds/plugin-qr/make';
import { gotoHydrated, serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE = 'https://example.com/scanned?from=camera';

/** A few frames of `text` as a QR code, black on white, in the middle of a 640 × 480 picture. */
function qrVideo(text: string): string {
	const width = 640;
	const height = 480;
	const { size, modules } = encodeQr(text);
	const scale = Math.floor(360 / (size + 8));
	const side = (size + 8) * scale;
	const left = Math.floor((width - side) / 2);
	const top = Math.floor((height - side) / 2);
	const luma = Buffer.alloc(width * height, 255);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			if (!modules[y * size + x]) continue;
			for (let dy = 0; dy < scale; dy++) {
				const row = (top + (y + 4) * scale + dy) * width + left + (x + 4) * scale;
				luma.fill(0, row, row + scale);
			}
		}
	const chroma = Buffer.alloc((width / 2) * (height / 2) * 2, 128);
	const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma]);
	const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`);
	const file = join(mkdtempSync(join(tmpdir(), 'xcwds-qr-')), 'code.y4m');
	writeFileSync(file, Buffer.concat([header, ...Array.from({ length: 10 }, () => frame)]));
	return file;
}

// A per-file `launchOptions` replaces the config's, so this repeats its Chromium and flag.
test.use({
	viewport: { width: 390, height: 844 },
	permissions: ['camera'],
	launchOptions: {
		executablePath: process.env.CHROMIUM_PATH || undefined,
		args: [
			'--disable-gpu',
			'--use-fake-device-for-media-stream',
			'--use-fake-ui-for-media-stream',
			`--use-file-for-fake-video-capture=${qrVideo(CODE)}`
		]
	}
});

const build = fileURLToPath(new URL('../build', import.meta.url));
let server: StaticServer;
const url = (path: string) => server.url(path);

test.beforeAll(async () => {
	server = await serveStatic(build);
});
test.afterAll(() => server.close());

test('scans only after a tap, reports the code, then turns the camera and its Worker off', async ({
	page
}) => {
	const away: string[] = [];
	page.on('request', (request) => {
		const target = new URL(request.url());
		if (!['data:', 'blob:'].includes(target.protocol) && target.origin !== new URL(url('/')).origin)
			away.push(request.url());
	});
	const closed: string[] = [];
	page.on('worker', (worker) => worker.on('close', () => closed.push(worker.url())));
	await gotoHydrated(page, url('/utils/qr'));
	const scanner = page.getByTestId('qr-scanner');
	await expect(scanner.locator('[data-state]')).toHaveAttribute('data-state', 'idle');

	await scanner.getByRole('button', { name: 'Scan a code' }).click();
	await expect(page.getByTestId('qr-scanned')).toHaveText(CODE);
	await expect(page.getByTestId('qr-scanned')).toHaveAttribute('data-kind', 'url');
	// The first code turns the camera off, and the decoder's Worker goes with it.
	await expect(scanner.locator('[data-state]')).toHaveAttribute('data-state', 'idle');
	await expect(scanner.getByRole('button', { name: 'Scan a code' })).toBeVisible();
	await expect.poll(() => closed.length).toBe(1);
	expect(away).toEqual([]);
});

test('leaving the page while scanning turns the camera off', async ({ page }) => {
	await gotoHydrated(page, url('/utils/qr'));
	const scanner = page.getByTestId('qr-scanner');
	// Keep it from finding the code, so it stays live.
	await page.evaluate(() => {
		const video = HTMLVideoElement.prototype;
		Object.defineProperty(video, 'readyState', { get: () => 0 });
	});
	await scanner.getByRole('button', { name: 'Scan a code' }).click();
	await expect(scanner.locator('[data-state]')).toHaveAttribute('data-state', 'live');
	await expect(scanner.getByText('Point the camera at a code.')).toBeVisible();
	await page.evaluate(() => {
		const video = document.querySelector<HTMLVideoElement>('[data-testid="qr-scanner"] video')!;
		(window as unknown as { track: MediaStreamTrack }).track = (
			video.srcObject as MediaStream
		).getVideoTracks()[0]!;
	});
	await page.locator('header [data-shell-back]').click();
	await expect(page).toHaveURL(url('/utils'));
	await expect
		.poll(() =>
			page.evaluate(() => (window as unknown as { track: MediaStreamTrack }).track.readyState)
		)
		.toBe('ended');
});
