// @xcwds/plugin-recorder (#150) in examples/minimal, with Chromium's fake microphone (a beeping
// tone): /utils/recorder shows `<Recorder>` and `<Recordings>` over `app.recorder`.
import { expect, test, type Page } from '@playwright/test';
import { gotoHydrated, serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

// A per-file `launchOptions` replaces the config's, so this repeats its Chromium and flag.
test.use({
	viewport: { width: 390, height: 844 },
	permissions: ['microphone'],
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

const state = (page: Page) => page.getByTestId('recorder');
const items = (page: Page) => page.getByRole('list', { name: 'Recordings' }).getByRole('listitem');

/** Records for a little over one chunk (3 seconds), so something is saved before Stop. */
async function record(page: Page) {
	await page.getByRole('button', { name: 'Record' }).click();
	await expect(state(page)).toHaveAttribute('data-state', 'recording');
	await expect(page.getByTestId('recorder-time')).toHaveText('0:03', { timeout: 10_000 });
}

test('records only on a tap, keeps it, plays it, and renames and deletes it', async ({ page }) => {
	const away: string[] = [];
	page.on('request', (request) => {
		const target = new URL(request.url());
		if (!['data:', 'blob:'].includes(target.protocol) && target.origin !== new URL(url('/')).origin)
			away.push(request.url());
	});
	await gotoHydrated(page, url('/utils/recorder'));
	await expect(page.getByRole('heading', { level: 1, name: 'Voice memos' })).toBeVisible();
	await expect(state(page)).toHaveAttribute('data-state', 'idle');
	await expect(page.getByTestId('recordings')).toContainText('No recordings yet.');

	await record(page);
	// The meter moves with the fake microphone's beeps (short, once a second): the loudest it
	// showed over two seconds.
	const loudest = await page.getByRole('meter').evaluate(
		(meter) =>
			new Promise<number>((resolve) => {
				let max = 0;
				const watch = new MutationObserver(() => {
					max = Math.max(max, Number(meter.getAttribute('aria-valuenow')));
				});
				watch.observe(meter, { attributes: true });
				setTimeout(() => {
					watch.disconnect();
					resolve(max);
				}, 2000);
			})
	);
	expect(loudest).toBeGreaterThan(0);
	await page.getByRole('button', { name: 'Pause' }).click();
	await expect(state(page)).toHaveAttribute('data-state', 'paused');
	await page.getByRole('button', { name: 'Resume' }).click();
	await page.getByRole('button', { name: 'Stop and save' }).click();
	await expect(page.getByTestId('recorder-status')).toHaveText('Recording saved.');
	await expect(state(page)).toHaveAttribute('data-state', 'idle');
	await expect(items(page)).toHaveCount(1);
	await expect(items(page)).toContainText(/^Recording, .*0:0[3-9]/);

	// It plays, from an object URL.
	await items(page).getByRole('button', { name: /^Play/ }).click();
	const player = page.getByTestId('player');
	await expect(player).toHaveAttribute('src', /^blob:/);
	await expect
		.poll(() => player.evaluate((audio: HTMLAudioElement) => audio.readyState))
		.toBeGreaterThan(0);
	expect(await player.evaluate((audio: HTMLAudioElement) => audio.duration)).toBeGreaterThan(0);

	// Kept on the device: there after a reload.
	await page.reload();
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await expect(items(page)).toHaveCount(1);

	await items(page)
		.getByRole('button', { name: /^Rename/ })
		.click();
	await page.getByRole('textbox', { name: 'Name' }).fill('Shopping list');
	await page.getByRole('button', { name: 'Save name' }).click();
	await expect(items(page)).toContainText(/^Shopping list/);

	await items(page).getByRole('button', { name: 'Delete Shopping list' }).click();
	await expect(page.getByTestId('recordings')).toContainText('No recordings yet.');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(items(page)).toHaveCount(1);
	await expect(items(page)).toContainText(/^Shopping list/);
	await items(page).getByRole('button', { name: 'Delete Shopping list' }).click();
	await expect(page.getByTestId('recordings')).toContainText('No recordings yet.');
	expect(away).toEqual([]);
});

test('discard throws a recording away', async ({ page }) => {
	await gotoHydrated(page, url('/utils/recorder'));
	await record(page);
	await page.getByRole('button', { name: 'Discard' }).click();
	await expect(page.getByTestId('recorder-status')).toHaveText('Recording discarded.');
	await expect(page.getByTestId('recordings')).toContainText('No recordings yet.');
});

test('keeps recording while another page shows', async ({ page }) => {
	await gotoHydrated(page, url('/utils/recorder'));
	await page.getByRole('button', { name: 'Record' }).click();
	await expect(state(page)).toHaveAttribute('data-state', 'recording');
	await page.locator('header [data-shell-back]').click();
	await expect(page).toHaveURL(url('/utils'));
	await page.getByRole('link', { name: /Voice memos/ }).click();
	await expect(state(page)).toHaveAttribute('data-state', 'recording');
	await page.getByRole('button', { name: 'Stop and save' }).click();
	await expect(items(page)).toHaveCount(1);
});

test('a recording cut off by closing the page is there next time', async ({ context }) => {
	const first = await context.newPage();
	await gotoHydrated(first, url('/utils/recorder'));
	await record(first);
	await first.close();

	const page = await context.newPage();
	await gotoHydrated(page, url('/utils/recorder'));
	await expect(items(page)).toHaveCount(1);
	await expect(items(page)).toContainText(/0:0[2-9]/);
});
