// @xcwds/plugin-scanner (#151) in examples/minimal, with Chromium's fake camera: /utils/scanner
// takes a photo with `<Camera>` and crops it with `<Crop>`, which saves the page to `app.scanner`.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoHydrated, serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

// A per-file `launchOptions` replaces the config's, so this repeats its Chromium and flag.
test.use({
	viewport: { width: 390, height: 844 },
	permissions: ['camera'],
	launchOptions: {
		executablePath: process.env.CHROMIUM_PATH || undefined,
		args: ['--disable-gpu', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
	}
});

const build = fileURLToPath(new URL('../build', import.meta.url));
let server: StaticServer;
const url = (path: string) => server.url(path);

test.beforeAll(async () => {
	server = await serveStatic(build);
});
test.afterAll(() => server.close());

const corner = (page: Page, name: string) =>
	page.getByRole('button', { name: `${name} corner`, exact: true });
const at = async (handle: Locator) => ({
	x: Number(await handle.getAttribute('data-x')),
	y: Number(await handle.getAttribute('data-y'))
});

async function takePhoto(page: Page) {
	await page.getByRole('button', { name: 'Turn on camera' }).click();
	await page.getByRole('button', { name: 'Take photo' }).click();
	await expect(page.getByTestId('crop')).toBeVisible();
	await expect(corner(page, 'Top left')).toBeVisible();
}

test('crops a photo with the corner handles and keeps the page', async ({ page }) => {
	const away: string[] = [];
	page.on('request', (request) => {
		const target = new URL(request.url());
		if (!['data:', 'blob:'].includes(target.protocol) && target.origin !== new URL(url('/')).origin)
			away.push(request.url());
	});
	await gotoHydrated(page, url('/utils/scanner'));
	await expect(page.getByRole('heading', { level: 1, name: 'Scanner' })).toBeVisible();
	await expect(page.getByTestId('scan-pages')).toHaveText('0 pages scanned');

	await takePhoto(page);
	// The fake camera's picture has no page in it, so the handles start on the photo's corners.
	await expect(page.getByText('Couldn’t find the page.')).toBeVisible();
	const topLeft = corner(page, 'Top left');
	const bottomRight = corner(page, 'Bottom right');
	expect(await at(topLeft)).toEqual({ x: 0, y: 0 });
	const far = await at(bottomRight);
	expect(far.x).toBeGreaterThan(0);
	expect(far.y).toBeGreaterThan(0);
	// Every handle is a full tap target.
	for (const name of ['Top left', 'Top right', 'Bottom right', 'Bottom left']) {
		const box = (await corner(page, name).boundingBox())!;
		expect(box.width).toBeGreaterThanOrEqual(44);
		expect(box.height).toBeGreaterThanOrEqual(44);
	}

	// Arrow keys move the focused corner 1% of the shorter side, Shift 10%; it stays in the photo.
	const step = Math.max(1, Math.round(Math.min(far.x, far.y) / 100));
	await topLeft.focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByTestId('crop-moved')).toHaveText(
		/^Top left corner: \d+% across, 0% down$/
	);
	await page.keyboard.press('Shift+ArrowDown');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	expect(await at(topLeft)).toEqual({ x: 0, y: step * 10 });

	// Dragging the bottom right corner past the top left crosses the sides: no page to add.
	const add = page.getByRole('button', { name: 'Add page' });
	const from = (await bottomRight.boundingBox())!;
	const to = (await topLeft.boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x - 10, to.y - 10, { steps: 5 });
	await page.mouse.up();
	expect(await at(bottomRight)).toEqual({ x: 0, y: 0 });
	await expect(page.getByText('The corners cross or bunch up')).toBeVisible();
	await expect(add).toBeDisabled();

	// Back to where they started, then a smaller crop by dragging, in Black & white.
	await page.getByRole('button', { name: 'Reset corners' }).click();
	expect(await at(bottomRight)).toEqual(far);
	await expect(page.getByText('The corners cross or bunch up')).toHaveCount(0);
	const start = (await bottomRight.boundingBox())!;
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
	await page.mouse.down();
	await page.mouse.move(start.x - 60, start.y - 40, { steps: 5 });
	await page.mouse.up();
	const dragged = await at(bottomRight);
	expect(dragged.x).toBeLessThan(far.x);
	expect(dragged.y).toBeLessThan(far.y);
	await page.getByRole('radio', { name: 'Black & white' }).check();
	await expect(add).toBeEnabled();
	await add.click();

	// Saved: back to the viewfinder, one page, and it survives a reload.
	await expect(page.getByTestId('crop')).toHaveCount(0);
	await expect(page.getByTestId('scan-pages')).toHaveText('1 page scanned');
	await page.reload();
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await expect(page.getByTestId('scan-pages')).toHaveText('1 page scanned');

	// The page's filter choice went with the reload; Cancel adds nothing.
	await takePhoto(page);
	await expect(page.getByRole('radio', { name: 'Original' })).toBeChecked();
	await page.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByTestId('crop')).toHaveCount(0);
	await expect(page.getByTestId('scan-pages')).toHaveText('1 page scanned');
	expect(away).toEqual([]);
});
