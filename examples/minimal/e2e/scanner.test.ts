// @xcwds/plugin-scanner (#151) in examples/minimal, with Chromium's fake camera: /utils/scanner
// takes a photo with `<Camera>` and crops it with `<Crop>`, which saves the page to `app.scanner`;
// `<Pages>` lists, reorders, retakes and deletes the pages, and exports them.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoHydrated, serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { readFile } from 'node:fs/promises';
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
	await expect(page.getByText('No pages yet.')).toBeVisible();

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
	await expect(page.getByTestId('scan-page')).toHaveCount(1);
	await page.reload();
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await expect(page.getByTestId('scan-page')).toHaveCount(1);

	// The page's filter choice went with the reload; Cancel adds nothing.
	await takePhoto(page);
	await expect(page.getByRole('radio', { name: 'Original' })).toBeChecked();
	await page.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByTestId('crop')).toHaveCount(0);
	await expect(page.getByTestId('scan-page')).toHaveCount(1);
	expect(away).toEqual([]);
});

/** The pages' filters, in order: each page here is told apart by the filter that made it. */
const filters = (page: Page) =>
	page
		.getByTestId('scan-page')
		.evaluateAll((items) => items.map((i) => i.getAttribute('data-filter')));

async function addPage(page: Page, filter: string, button = 'Add page') {
	await takePhoto(page);
	await page.getByRole('radio', { name: filter }).check();
	await page.getByRole('button', { name: button }).click();
	await expect(page.getByTestId('crop')).toHaveCount(0);
}

test('reorders, retakes, deletes and exports the pages', async ({ page }) => {
	const away: string[] = [];
	page.on('request', (request) => {
		const target = new URL(request.url());
		if (!['data:', 'blob:'].includes(target.protocol) && target.origin !== new URL(url('/')).origin)
			away.push(request.url());
	});
	await gotoHydrated(page, url('/utils/scanner'));
	await expect(page.getByText('No pages yet.')).toBeVisible();
	// Nothing to export yet.
	await expect(page.getByRole('heading', { name: 'Export' })).toHaveCount(0);

	await addPage(page, 'Original');
	await addPage(page, 'Greyscale');
	await expect(page.getByTestId('scan-page')).toHaveCount(2);
	expect(await filters(page)).toEqual(['original', 'greyscale']);
	await expect(page.getByRole('img', { name: 'Page 1 of 2' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Up page 1' })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Down page 2' })).toBeDisabled();

	// Up moves the second page first.
	await page.getByRole('button', { name: 'Up page 2' }).click();
	await expect.poll(() => filters(page)).toEqual(['greyscale', 'original']);

	// Retake replaces the first page in its place.
	await page.getByRole('button', { name: 'Retake page 1' }).click();
	await expect(page.getByTestId('retaking')).toBeVisible();
	await addPage(page, 'Black & white', 'Replace page');
	await expect(page.getByTestId('retaking')).toHaveCount(0);
	await expect.poll(() => filters(page)).toEqual(['bw', 'original']);

	// Delete, then Undo puts the page back where it was.
	await page.getByRole('button', { name: 'Delete page 1' }).click();
	await expect.poll(() => filters(page)).toEqual(['original']);
	await expect(page.getByTestId('scan-status')).toContainText('Page deleted.');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect.poll(() => filters(page)).toEqual(['bw', 'original']);

	// The order survives a reload.
	await page.reload();
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await expect.poll(() => filters(page)).toEqual(['bw', 'original']);

	// Headless Linux has no Web Share, so Export saves: one 2-page PDF, here on Letter.
	await expect(page.getByRole('heading', { name: 'Export' })).toBeVisible();
	await page.getByRole('radio', { name: 'Letter' }).check();
	const exportButton = page.getByTestId('scan-export');
	await expect(exportButton).toHaveText('Save');
	const [pdf] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
	expect(pdf.suggestedFilename()).toMatch(/^scan-\d{8}-\d{6}\.pdf$/);
	const bytes = await readFile((await pdf.path())!, 'latin1');
	expect(bytes.startsWith('%PDF-')).toBe(true);
	expect(bytes).toContain('/Count 2');
	// The fake camera's picture is landscape, so each page is landscape Letter.
	expect(bytes).toContain('/MediaBox [0 0 792 612]');
	expect(bytes).not.toMatch(/\/Producer|\/Author|\/CreationDate/);
	await expect(page.getByTestId('scan-note')).toContainText('outside this app');

	// Images: one JPEG per page.
	await page.getByRole('radio', { name: 'Images' }).check();
	await expect(page.getByRole('radio', { name: 'Letter' })).toHaveCount(0);
	const downloads: string[] = [];
	page.on('download', (d) => downloads.push(d.suggestedFilename()));
	await expect(exportButton).toHaveText('Save');
	await exportButton.click();
	await expect.poll(() => downloads.length).toBe(2);
	expect(downloads[0]).toMatch(/^scan-\d{8}-\d{6}-1\.jpg$/);
	expect(downloads[1]).toMatch(/^scan-\d{8}-\d{6}-2\.jpg$/);

	// Start over takes a second tap.
	const startOver = page.getByRole('button', { name: 'Start over' });
	await startOver.click();
	await expect(page.getByTestId('scan-page')).toHaveCount(2);
	await page.getByRole('button', { name: 'Tap again to delete every page' }).click();
	await expect(page.getByText('No pages yet.')).toBeVisible();
	await expect(page.getByTestId('scan-page')).toHaveCount(0);
	expect(away).toEqual([]);
});
