// @xcwds/plugin-qr (#147) in examples/minimal: /utils/qr draws `<QrCode>` for what you type, and
// an independent decoder (jsQR) reads the drawn code back.
import { expect, test, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import { gotoHydrated, serveStatic, type StaticServer } from '@xcwds/testing/playwright';
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
