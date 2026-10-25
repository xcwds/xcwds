// @xcwds/plugin-offline's `byApp` (#163): only the apps that are on are kept offline. Kitchen
// holds the Coffee Timer and Timer tools, Hello the example plugin's page. Each test serves its
// own copy of the build (`serveDeployment`), so a fake deploy never leaks into another test.
import { expect, test, type Page } from '@playwright/test';
import {
	gotoHydrated,
	pageVersion,
	serveDeployment,
	waitForServiceWorker,
	type Deployment
} from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

test.use({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });

const targets = [
	{ name: 'at the root', dir: 'build', base: '' },
	{ name: 'under a base path', dir: 'build-sub', base: '/sub' }
];

const toggle = (page: Page, name: string) => page.getByRole('switch', { name, exact: true });
const banner = (page: Page) => page.getByTestId('update-banner');

/** The deploy marker of the copy the worker keeps of `href`, or null when it keeps none. */
const kept = (page: Page, href: string) =>
	page.evaluate(async (href) => {
		const response = await caches.match(href);
		if (!response) return null;
		const html = await response.text();
		return /<meta name="test-version" content="([^"]*)"/.exec(html)?.[1] ?? 'original';
	}, href);

for (const { name, dir, base } of targets) {
	test.describe(name, () => {
		const build = fileURLToPath(new URL(`../${dir}`, import.meta.url));
		let deployment: Deployment;
		const url = (path: string) => deployment.url(path);

		test.beforeEach(async () => {
			deployment = await serveDeployment(build, { base });
		});
		test.afterEach(() => deployment.close());

		async function open(page: Page, path: string) {
			await gotoHydrated(page, url(path));
			await waitForServiceWorker(page);
		}

		async function setKitchen(page: Page, on: boolean) {
			await open(page, '/apps');
			await toggle(page, 'Kitchen').click();
			await expect(toggle(page, 'Kitchen')).toHaveAttribute('aria-checked', String(on));
		}

		test('turning an app off deletes its pages from the offline copy; on downloads them', async ({
			page
		}) => {
			await open(page, '/');
			await expect.poll(() => kept(page, url('/utils/coffee'))).toBe('original');
			await expect.poll(() => kept(page, url('/hello'))).toBe('original');

			await setKitchen(page, false);
			await expect.poll(() => kept(page, url('/utils/coffee'))).toBeNull();
			expect(await kept(page, url('/utils/timer'))).toBeNull();
			// Pages in no app, and other apps, stay.
			expect(await kept(page, url('/utils/dice'))).toBe('original');
			expect(await kept(page, url('/hello'))).toBe('original');

			await setKitchen(page, true);
			await expect.poll(() => kept(page, url('/utils/coffee'))).toBe('original');
			expect(await kept(page, url('/utils/timer'))).toBe('original');
		});

		test('the Apps page says what each app keeps offline, and follows it turning off and on', async ({
			page
		}) => {
			await open(page, '/apps');
			const card = (name: string) => page.getByTestId('app-card').filter({ hasText: name });
			const kitchen = card('Kitchen').getByTestId('app-offline');
			// Its two tools' pages, as the worker's cache holds them.
			await expect(kitchen).toHaveText(/^Kept offline: 2 pages, [\d.]+ (KB|bytes)$/);
			await expect(card('Hello').getByTestId('app-offline')).toHaveText(/^Kept offline: 1 page, /);
			await expect(page.getByTestId('offline-storage')).toHaveText(
				/^Stored on this device: about [\d.]+ (bytes|KB|MB), offline copies and saved data included\.$/
			);

			await toggle(page, 'Kitchen').click();
			await expect(kitchen).toHaveText('Not kept offline');
			await toggle(page, 'Kitchen').click();
			await expect(kitchen).toHaveText(/^Kept offline: 2 pages, /);
		});

		test('an update keeps the apps that were on offline, and not the ones turned off', async ({
			page,
			context
		}) => {
			await setKitchen(page, false);
			await expect.poll(() => kept(page, url('/utils/coffee'))).toBeNull();

			await deployment.deployNewVersion('next');
			await expect(async () => {
				await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
				await expect(banner(page)).toContainText('A new version is available.', {
					timeout: 1000
				});
			}).toPass({ timeout: 15_000 });
			await Promise.all([
				page.waitForEvent('load'),
				banner(page).getByRole('button', { name: 'Update', exact: true }).click()
			]);
			expect(await pageVersion(page)).toBe('next');

			// The new version's install downloaded Hello's page, not Kitchen's.
			expect(await kept(page, url('/hello'))).toBe('next');
			expect(await kept(page, url('/utils/coffee'))).toBeNull();

			await context.setOffline(true);
			await page.goto(url('/hello'));
			await expect(page.getByTestId('plugin-page')).toHaveText("hi from a plugin's page component");
			expect(await pageVersion(page)).toBe('next');
			await context.setOffline(false);
		});
	});
}
