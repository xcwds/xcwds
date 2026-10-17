// @xcwds/plugin-qr (#147) in examples/minimal: /utils/qr draws `<QrCode>` for what you type, and
// an independent decoder (jsQR) reads the drawn code back; a picked image is read with `scan()`.
import { expect, test, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import { gotoHydrated, serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test.use({ viewport: { width: 390, height: 844 } });

const build = fileURLToPath(new URL('../build', import.meta.url));
let server: StaticServer;
const url = (path: string) => server.url(path);

test.beforeAll(async () => {
	server = await serveStatic(build);
});
test.afterAll(() => server.close());

/**
 * Draws the page's QR code from its SVG (the white square and the dark path) as pixels, and decodes
 * them with jsQR in Node (the page's CSP rightly refuses an injected script).
 */
async function readCode(page: Page): Promise<string | undefined> {
	const svg = page.locator('svg[data-qr]');
	const side = Number((await svg.getAttribute('viewBox'))!.split(' ')[2]);
	const d = (await svg.locator('path').getAttribute('d'))!;
	const scale = 4;
	const width = side * scale;
	const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
	for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g))
		for (let row = Number(y) * scale; row < (Number(y) + 1) * scale; row++)
			pixels.fill(
				0,
				(row * width + Number(x) * scale) * 4,
				(row * width + (Number(x) + Number(w)) * scale) * 4
			);
	// Black is 0, 0, 0 with alpha 0 after the fill above; restore the alpha.
	for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
	const found = jsQR(pixels, width, width);
	return found ? new TextDecoder().decode(new Uint8Array(found.binaryData)) : undefined;
}

test('draws what you type as a QR code that reads back, and says when it is too long', async ({
	page
}) => {
	await gotoHydrated(page, url('/utils/qr'));
	await expect(page.getByRole('heading', { level: 1, name: 'QR code' })).toBeVisible();
	const code = page.getByRole('img', { name: 'QR code: https://example.com' });
	await expect(code).toBeVisible();
	expect(await readCode(page)).toBe('https://example.com');

	const text = 'WIFI:S:Café ☕;T:WPA;P:p@ss;;';
	await page.getByLabel('Text or link').fill(text);
	await expect(page.getByRole('img', { name: `QR code: ${text}` })).toBeVisible();
	expect(await readCode(page)).toBe(text);

	// Nothing to show for nothing: a code would scan to an empty string.
	await page.getByLabel('Text or link').fill('');
	await expect(page.locator('svg[data-qr]')).toHaveCount(0);
	await expect(page.getByRole('alert')).toHaveCount(0);

	await page.getByLabel('Text or link').fill('a'.repeat(2400));
	await expect(page.getByRole('alert')).toHaveText('This is too long for a QR code.');
	await expect(page.locator('svg[data-qr]')).toHaveCount(0);
});

test('reads a code from an image with the bundled decoder in a Worker, and finds none in a plain one', async ({
	page
}) => {
	const workers: string[] = [];
	page.on('worker', (worker) => workers.push(worker.url()));
	await gotoHydrated(page, url('/utils/qr'));
	const text = 'WIFI:S:Café ☕;T:WPA;P:p@ss;;';
	await page.getByLabel('Text or link').fill(text);
	// This Chromium has no BarcodeDetector, so the fallback reads it.
	expect(await page.evaluate(() => 'BarcodeDetector' in window)).toBe(false);
	const png = await page.locator('svg[data-qr]').screenshot();
	await page
		.getByTestId('qr-file')
		.setInputFiles({ name: 'code.png', mimeType: 'image/png', buffer: png });
	await expect(page.getByTestId('qr-found')).toHaveText('Wi-Fi: Café ☕');
	await expect(page.getByTestId('qr-found')).toHaveAttribute('data-kind', 'wifi');
	expect(workers).toHaveLength(1);
	expect(new URL(workers[0]!).origin).toBe(new URL(url('/')).origin);

	const plain = await page.getByRole('heading', { level: 1 }).screenshot();
	await page
		.getByTestId('qr-file')
		.setInputFiles({ name: 'plain.png', mimeType: 'image/png', buffer: plain });
	await expect(page.getByTestId('qr-found')).toHaveText('No code found in that image.');

	await page
		.getByTestId('qr-file')
		.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a png') });
	await expect(page.getByText("That image couldn't be read.")).toBeVisible();
});

test("prefers the browser's BarcodeDetector where it reads QR codes", async ({ page }) => {
	await page.addInitScript(() => {
		class BarcodeDetector {
			static async getSupportedFormats() {
				return ['qr_code'];
			}
			async detect() {
				return [{ rawValue: 'https://example.com/from-detector', format: 'qr_code' }];
			}
		}
		Object.assign(window, { BarcodeDetector });
	});
	const workers: string[] = [];
	page.on('worker', (worker) => workers.push(worker.url()));
	await gotoHydrated(page, url('/utils/qr'));
	const png = await page.locator('svg[data-qr]').screenshot();
	await page
		.getByTestId('qr-file')
		.setInputFiles({ name: 'code.png', mimeType: 'image/png', buffer: png });
	await expect(page.getByTestId('qr-found')).toHaveText('https://example.com/from-detector');
	await expect(page.getByTestId('qr-found')).toHaveAttribute('data-kind', 'url');
	expect(workers).toEqual([]);
});

test('reads a code on the page when the Worker file is out of reach (offline before it was cached)', async ({
	page
}) => {
	await page.route('**/workers/**', (route) => route.abort());
	await gotoHydrated(page, url('/utils/qr'));
	const png = await page.locator('svg[data-qr]').screenshot();
	await page
		.getByTestId('qr-file')
		.setInputFiles({ name: 'code.png', mimeType: 'image/png', buffer: png });
	await expect(page.getByTestId('qr-found')).toHaveText('https://example.com');
});

test('downloads the code as SVG or PNG, made on the device, that read back', async ({ page }) => {
	await gotoHydrated(page, url('/utils/qr'));
	await page.getByLabel('Text or link').fill('https://example.com/download');

	const [svg] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Download SVG' }).click()
	]);
	expect(svg.suggestedFilename()).toBe('qr-code.svg');
	expect(new URL(svg.url()).protocol).toBe('blob:');
	const markup = await readFile((await svg.path())!, 'utf8');
	expect(markup).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
	expect(markup).toContain('aria-label="QR code: https://example.com/download"');

	const [png] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Download PNG' }).click()
	]);
	expect(png.suggestedFilename()).toBe('qr-code.png');
	const bytes = await readFile((await png.path())!);
	expect(bytes.subarray(1, 4).toString()).toBe('PNG');
	// The PNG reads back through the page's own scan().
	await page
		.getByTestId('qr-file')
		.setInputFiles({ name: 'qr-code.png', mimeType: 'image/png', buffer: bytes });
	await expect(page.getByTestId('qr-found')).toHaveText('https://example.com/download');

	// Nothing to download for nothing, or for text too long for a code.
	await page.getByLabel('Text or link').fill('');
	await expect(page.getByRole('button', { name: /Download/ })).toHaveCount(0);
});
