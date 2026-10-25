// @xcwds/plugin-share (#16) in examples/minimal, ported from xcwds.github.io's share test: the
// installed app's Share button shares the page's link only, falls back to copying, and hides
// where it shouldn't be; shares received at /inbox never reach the server once the worker runs.
import { expect, test, type Page } from '@playwright/test';
import {
	gotoHydrated,
	serveStatic,
	waitForServiceWorker,
	type StaticServer
} from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

test.use({ viewport: { width: 390, height: 844 } });

/**
 * Makes the page think it runs as the installed app, and records what it shares instead of
 * opening a share sheet (or removes the share API, as on some desktop installs).
 */
async function asInstalledApp(page: Page, { canShare = true } = {}) {
	await page.addInitScript((canShare) => {
		const real = window.matchMedia.bind(window);
		window.matchMedia = (query: string) => {
			const list = real(query);
			if (query === '(display-mode: standalone)')
				Object.defineProperty(list, 'matches', { value: true });
			return list;
		};
		const shared: ShareData[] = [];
		Object.assign(window, { __shared: shared });
		Object.defineProperty(Navigator.prototype, 'share', {
			configurable: true,
			value: canShare ? async (data: ShareData) => void shared.push(data) : undefined
		});
	}, canShare);
}

const sharedData = (page: Page) =>
	page.evaluate(() => (window as unknown as { __shared: ShareData[] }).__shared);
const shareButtons = (page: Page) => page.getByRole('button', { name: /^Share / });

const targets = [
	{ name: 'at the root', dir: 'build', base: '' },
	{ name: 'under a base path', dir: 'build-sub', base: '/sub' }
];

for (const { name, dir, base } of targets) {
	test.describe(name, () => {
		const build = fileURLToPath(new URL(`../${dir}`, import.meta.url));
		let server: StaticServer;
		const url = (path: string) => server.url(path);

		test.beforeAll(async () => {
			server = await serveStatic(build, { base });
		});
		test.afterAll(() => server.close());

		test('the installed app shares a page by its title and link', async ({ page }) => {
			await asInstalledApp(page);
			await gotoHydrated(page, url('/hello'));
			const button = page.getByRole('button', { name: 'Share Hello' });
			const box = (await button.boundingBox())!;
			expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
			await button.click();
			expect(await sharedData(page)).toEqual([
				{ title: 'Hello', text: 'Hello on Minimal', url: url('/hello') }
			]);
		});

		test('Home shares the app with its tagline', async ({ page }) => {
			await asInstalledApp(page);
			await gotoHydrated(page, url('/'));
			await page.getByRole('button', { name: 'Share Minimal' }).click();
			expect(await sharedData(page)).toEqual([
				{
					title: 'Minimal',
					text: 'Minimal: The smallest @xcwds app.',
					url: `${server.origin}${base}/`
				}
			]);
		});

		test('sharing never sends the query or hash', async ({ page }) => {
			await asInstalledApp(page);
			await gotoHydrated(page, url('/hello?q=private#secret'));
			await page.getByRole('button', { name: 'Share Hello' }).click();
			const [data] = await sharedData(page);
			expect(data!.url).toBe(url('/hello'));
			expect(JSON.stringify(data)).not.toMatch(/private|secret/);
		});

		test('without a share sheet it copies the link instead', async ({ page, context }) => {
			await context.grantPermissions(['clipboard-read', 'clipboard-write']);
			await asInstalledApp(page, { canShare: false });
			await gotoHydrated(page, url('/hello'));
			await page.getByRole('button', { name: 'Share Hello' }).click();
			await expect(page.getByTestId('toast')).toHaveText('Link copied.');
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url('/hello'));
		});

		test('no Share button in a browser tab, on excluded, private or error pages', async ({
			page
		}) => {
			await gotoHydrated(page, url('/hello'));
			await expect(page.getByRole('heading', { level: 1, name: 'Hello' })).toBeVisible();
			await expect(shareButtons(page)).toHaveCount(0);

			await asInstalledApp(page);
			await gotoHydrated(page, url('/inbox'));
			await expect(page.getByText('Nothing shared yet.')).toBeVisible();
			await expect(shareButtons(page)).toHaveCount(0);
			await gotoHydrated(page, url('/no-such-page'));
			await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
			await expect(shareButtons(page)).toHaveCount(0);
			// A private tool's route (@xcwds/plugin-tools).
			await gotoHydrated(page, url('/utils/journal'));
			await expect(page.getByRole('heading', { level: 1, name: 'Journal' })).toBeVisible();
			await expect(shareButtons(page)).toHaveCount(0);
			await gotoHydrated(page, url('/'));
			await expect(page.getByRole('button', { name: 'Share Minimal' })).toBeVisible();
		});

		test('the manifest makes /inbox a share target', async ({ request }) => {
			const manifest = await (await request.get(url('/manifest.webmanifest'))).json();
			const params = { url: 'url', text: 'text', title: 'title' };
			// The base-path build takes shared images too (`files`, #148): a POST the worker answers.
			expect(manifest.share_target).toEqual(
				base
					? {
							action: `${base}/inbox`,
							method: 'POST',
							enctype: 'multipart/form-data',
							params: { ...params, files: [{ name: 'files', accept: ['image/*'] }] }
						}
					: {
							action: `${base}/inbox`,
							method: 'GET',
							enctype: 'application/x-www-form-urlencoded',
							params
						}
			);
		});

		test('Settings → Privacy says when a shared image can reach the server', async ({ page }) => {
			await gotoHydrated(page, url('/settings'));
			const note = page.getByTestId('settings-privacy').getByTestId('share-files-note');
			if (!base) return void (await expect(note).toHaveCount(0));
			await expect(note).toContainText('is uploaded to 127.0.0.1');
			await expect(note).toContainText('Open Minimal once before sharing into it.');
		});

		test.describe('receiving a share', () => {
			test.use({ serviceWorkers: 'allow' });

			test('with the worker, the shared query never reaches the server', async ({ page }) => {
				await gotoHydrated(page, url('/'));
				await waitForServiceWorker(page);
				const before = server.requests.length;
				const shared = url('/inbox?title=Look&text=secret%20https%3A%2F%2Fx.example%2F');
				// The worker answers the shared URL itself, with a redirect to the fragment.
				const redirected = page.waitForResponse(
					(r) => r.url() === shared && r.status() === 303 && r.fromServiceWorker()
				);
				await page.goto(shared);
				await redirected;
				await expect(page.getByTestId('shared')).toHaveText('secret https://x.example/ Look');
				await expect(page.getByTestId('shared-title')).toHaveText('Look');
				// Cleared from the address bar and history.
				expect(page.url()).toBe(url('/inbox'));
				expect(server.requests.slice(before).join('\n')).not.toContain('secret');
			});

			test('before the worker controls the page, the query is read and cleared', async ({
				page
			}) => {
				// Android may open the target cold, right after install: the server sees it once.
				await page.goto(url('/inbox?text=early'));
				await expect(page.getByTestId('shared')).toHaveText('early');
				expect(page.url()).toBe(url('/inbox'));
			});

			test('shared images stay on the device and are handed to the page once', async ({ page }) => {
				test.skip(!base, 'Only the base-path build takes shared images.');
				await gotoHydrated(page, url('/inbox'));
				await waitForServiceWorker(page);
				// The form Android's share sheet sends: a multipart POST to the target.
				await page.evaluate((action) => {
					const form = Object.assign(document.createElement('form'), {
						id: 'share-sheet',
						method: 'post',
						enctype: 'multipart/form-data',
						action
					});
					form.innerHTML =
						'<input type="file" name="files" multiple><input name="text" value="secret note">';
					document.body.append(form);
				}, url('/inbox'));
				await page.setInputFiles('#share-sheet input[type=file]', [
					{ name: 'cat.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') },
					{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') }
				]);
				const before = server.requests.length;
				const redirected = page.waitForResponse(
					(r) => r.url() === url('/inbox') && r.status() === 303 && r.fromServiceWorker()
				);
				await page.evaluate(() =>
					(document.getElementById('share-sheet') as HTMLFormElement).submit()
				);
				await redirected;
				await expect(page.getByTestId('shared-file')).toHaveText('cat.png (image/png, 16 bytes)');
				await expect(page.getByTestId('shared-skipped')).toHaveText('1 not kept');
				await expect(page.getByTestId('shared')).toHaveText('secret note');
				// Nothing reached the server: not the POST, nor the page it redirected to (precached).
				expect(server.requests.slice(before)).not.toContain(`${base}/inbox`);
				expect(page.url()).toBe(url('/inbox'));
				// The inbox is empty once the page has the files.
				const left = await page.evaluate(
					() =>
						new Promise<number>((resolve, reject) => {
							const open = indexedDB.open('app:blobs');
							open.onerror = () => reject(open.error);
							open.onsuccess = () => {
								const count = open.result
									.transaction('blobs')
									.objectStore('blobs')
									.count(IDBKeyRange.bound(['app:share:inbox', ''], ['app:share:inbox', []]));
								count.onsuccess = () => resolve(count.result);
							};
						})
				);
				expect(left).toBe(0);
			});

			test('the iPhone Shortcut opens #url= directly, also in a reused tab', async ({ page }) => {
				await gotoHydrated(page, url('/inbox#url=https%3A%2F%2Fx.example%2F%3Fa%3D1'));
				await expect(page.getByTestId('shared')).toHaveText('https://x.example/?a=1');
				expect(page.url()).toBe(url('/inbox'));
				// A link the Shortcut didn't encode keeps its & and +.
				await page.evaluate(() => (location.hash = '#url=https://x.example/?a=1&b=2+3'));
				await expect(page.getByTestId('shared')).toHaveText('https://x.example/?a=1&b=2+3');
				expect(page.url()).toBe(url('/inbox'));
			});
		});
	});
}
