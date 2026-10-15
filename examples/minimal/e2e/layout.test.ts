// @xcwds/plugin-shell (#13) in examples/minimal, ported from xcwds.github.io's layout test: which
// main navigation shows at each size and orientation, the `nav` setting that picks it (before
// first paint too), the header lining up with the page, notifications, toasts and Home.
import { expect, test, type Page } from '@playwright/test';
import {
	auditTapTargets,
	gotoHydrated,
	serveStatic,
	type StaticServer
} from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const nav = (page: Page, kind: 'tabs' | 'header' | 'sidebar') =>
	page.locator(`nav[data-shell-nav="${kind}"]`);

async function expectNav(page: Page, kind: 'tabs' | 'header' | 'sidebar') {
	// Only one navigation is ever exposed; the others are display:none.
	await expect(mainNav(page)).toHaveCount(1);
	for (const other of ['tabs', 'header', 'sidebar'] as const) {
		if (other === kind) await expect(nav(page, other)).toBeVisible();
		else await expect(nav(page, other)).toBeHidden();
	}
}

const viewports = {
	phone: { width: 390, height: 844 },
	phoneLandscape: { width: 844, height: 390 },
	tabletPortrait: { width: 820, height: 1180 },
	tabletLandscape: { width: 1180, height: 820 },
	desktop: { width: 1440, height: 900 }
};

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

		test.describe('default navigation', () => {
			const expected = {
				phone: 'tabs',
				phoneLandscape: 'header',
				tabletPortrait: 'header',
				tabletLandscape: 'sidebar',
				desktop: 'sidebar'
			} as const;
			for (const [size, viewport] of Object.entries(viewports)) {
				const kind = expected[size as keyof typeof expected];
				test(`${size} shows the ${kind} navigation`, async ({ page }) => {
					await page.setViewportSize(viewport);
					await gotoHydrated(page, url('/hello'));
					await expectNav(page, kind);
					await expect(nav(page, kind).getByRole('link', { name: 'Hello' })).toHaveAttribute(
						'aria-current',
						'page'
					);
				});
			}
		});

		test('the setting picks the navigation per orientation, before the app loads', async ({
			page
		}) => {
			await page.addInitScript(() => {
				if (localStorage.getItem('app:settings') !== null) return;
				localStorage.setItem(
					'app:settings',
					JSON.stringify({ nav: { portrait: 'sidebar', landscape: 'bar' } })
				);
			});
			await page.setViewportSize(viewports.tabletPortrait);
			// With every module blocked, only the pre-paint script can apply it.
			await page.route(/\.js$/, (route) => route.abort());
			await page.goto(url('/hello'));
			await expect(nav(page, 'sidebar')).toBeVisible();
			await page.unrouteAll();

			await gotoHydrated(page, url('/hello'));
			await expectNav(page, 'sidebar');
			await page.setViewportSize(viewports.tabletLandscape);
			await expectNav(page, 'header');
			// Phones keep their own navigation whatever the setting says.
			await page.setViewportSize(viewports.phoneLandscape);
			await expectNav(page, 'header');
			await page.setViewportSize(viewports.phone);
			await expectNav(page, 'tabs');
		});

		test('changing the setting switches the navigation', async ({ page }) => {
			await page.setViewportSize(viewports.desktop);
			await gotoHydrated(page, url('/'));
			await expectNav(page, 'sidebar');
			const landscape = page.getByRole('radiogroup', { name: 'Navigation in landscape' });
			await landscape.getByRole('radio', { name: 'Top bar' }).check();
			await expectNav(page, 'header');
			await page.reload();
			await expectNav(page, 'header');
			await landscape.getByRole('radio', { name: 'Sidebar' }).check();
			await expectNav(page, 'sidebar');
		});

		test.describe('with the sidebar', () => {
			test.use({ viewport: viewports.desktop });

			test('keyboard users reach the sidebar before the page', async ({ page }) => {
				await gotoHydrated(page, url('/hello'));
				await page.keyboard.press('Tab');
				await expect(nav(page, 'sidebar').getByRole('link', { name: 'Home' })).toBeFocused();
			});

			for (const path of ['/', '/hello', '/no-such-page']) {
				test(`the header lines up with the page on ${path}`, async ({ page }) => {
					await gotoHydrated(page, url(path));
					const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
					const main = (await page.locator('main').boundingBox())!;
					const side = (await nav(page, 'sidebar').boundingBox())!;
					// The page sits right of the sidebar, and the title starts at the page's content
					// edge (allowing for a back arrow in front of it).
					expect(main.x).toBeGreaterThanOrEqual(side.x + side.width);
					const padding = await page
						.locator('main')
						.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
					const back = page.locator('header [data-shell-back]');
					const start = (await back.count()) ? (await back.boundingBox())!.x + 8 : title.x;
					expect(Math.abs(start - (main.x + padding))).toBeLessThanOrEqual(1);
				});
			}

			test('notifications sit at the top right, clear of the page title', async ({
				page,
				context
			}) => {
				await gotoHydrated(page, url('/hello'));
				await context.setOffline(true);
				const notice = page.getByTestId('offline-notice');
				await expect(notice).toBeVisible();
				const box = (await notice.boundingBox())!;
				const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
				expect(box.x).toBeGreaterThan(title.x + title.width);
				await context.setOffline(false);
			});
		});

		for (const [size, viewport] of Object.entries(viewports)) {
			test(`no horizontal scrolling or small tap targets on ${size}`, async ({ page }) => {
				await page.setViewportSize(viewport);
				for (const path of [
					'/',
					'/hello',
					'/utils',
					'/apps',
					'/utils/dice',
					'/utils/timer',
					'/no-such-page'
				]) {
					await gotoHydrated(page, url(path));
					const overflow = await page.evaluate(
						() => document.documentElement.scrollWidth - document.documentElement.clientWidth
					);
					expect(overflow, path).toBeLessThanOrEqual(0);
					expect(await auditTapTargets(page), path).toEqual([]);
				}
			});
		}

		test('the header has the title, a way back, and the section highlighted', async ({ page }) => {
			await page.setViewportSize(viewports.phone);
			await gotoHydrated(page, url('/'));
			await expect(page.getByRole('heading', { level: 1 })).toHaveText('Minimal');
			await expect(page.locator('h1')).toHaveCount(1);
			await expect(page.locator('header [data-shell-back]')).toHaveCount(0);
			await expect(page.getByTestId('home-brand')).toContainText('The smallest @xcwds app.');
			await expect(page).toHaveTitle('Minimal');

			await nav(page, 'tabs').getByRole('link', { name: 'Hello' }).click();
			await expect(page.getByRole('heading', { level: 1, name: 'Hello' })).toBeVisible();
			await expect(page).toHaveTitle('Hello · Minimal');
			await page.getByRole('link', { name: 'Back to Home' }).click();
			await expect(page).toHaveURL(url('/'));
			await expect(nav(page, 'tabs').getByRole('link', { name: 'Home' })).toHaveAttribute(
				'aria-current',
				'page'
			);
		});

		test('the error page leads home and to each section', async ({ page }) => {
			await gotoHydrated(page, url('/no-such-page'));
			await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
			const links = page.getByRole('navigation', { name: 'Go to' }).getByRole('link');
			await expect(links).toHaveText(['🏠 Home', '👋 Hello', '🧰 Utils', '⚙️ Settings']);
			await links.nth(1).click();
			await expect(page).toHaveURL(url('/hello'));
		});

		test('toasts show in the stack and go away', async ({ page }) => {
			await page.setViewportSize(viewports.phone);
			await gotoHydrated(page, url('/hello'));
			await page.getByTestId('greeting').click();
			const toast = page.getByTestId('toast');
			await expect(toast).toHaveText('Greeting saved.');
			// Above the tab bar.
			const [a, b] = [(await toast.boundingBox())!, (await nav(page, 'tabs').boundingBox())!];
			expect(a.y + a.height).toBeLessThanOrEqual(b.y);
			// Beside the toast, taps reach the page, not the stack's full-width row.
			const beside = await page.evaluate(
				({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-shell-notices]'),
				{ x: a.x - 24, y: a.y + a.height / 2 }
			);
			expect(beside).toBe(false);
			await toast.click();
			await expect(toast).toHaveCount(0);
		});

		test('honours reduced motion', async ({ page }) => {
			await page.emulateMedia({ reducedMotion: 'reduce' });
			await gotoHydrated(page, url('/'));
			// The shell's rule sets every transition to 0.01ms (the default is 0s).
			const duration = await page
				.locator('main')
				.evaluate((el) => getComputedStyle(el).transitionDuration);
			expect(parseFloat(duration)).toBeGreaterThan(0);
			expect(parseFloat(duration)).toBeLessThan(0.001);
		});
	});
}
