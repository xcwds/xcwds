// Apps people turn on and off (#158): Kitchen holds the Coffee Timer and Timer tools, Hello the
// example plugin's page and data. Turning one off hides it, never blocks a page or loses data.
import { expect, test, type Page } from '@playwright/test';
import {
	auditTapTargets,
	gotoHydrated,
	serveStatic,
	type StaticServer
} from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

test.use({ viewport: { width: 390, height: 844 } });

const toolLinks = (page: Page) => page.getByTestId('tools').getByRole('link');
const card = (page: Page, name: string) => page.getByTestId('app-card').filter({ hasText: name });
const toggle = (page: Page, name: string) => page.getByRole('switch', { name, exact: true });

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

		test('turning an app off hides its tools and pins; its pages say so and turn it back on', async ({
			page
		}) => {
			await gotoHydrated(page, url('/utils'));
			await page.getByRole('button', { name: 'Pin Coffee Timer to Home' }).click();
			await page.getByTestId('apps-link').click();
			await expect(page).toHaveURL(url('/apps'));
			await expect(page.getByRole('heading', { level: 1, name: 'Apps' })).toBeVisible();
			await expect(card(page, 'Kitchen')).toContainText('☕ Coffee Timer · ⏲️ Timer');
			await expect(toggle(page, 'Kitchen')).toHaveAttribute('aria-checked', 'true');
			await toggle(page, 'Kitchen').click();
			await expect(toggle(page, 'Kitchen')).toHaveAttribute('aria-checked', 'false');
			await expect(page.getByTestId('toast').last()).toHaveText('Kitchen turned off.');
			// Kitchen saves nothing, so there's nothing to remove.
			await expect(card(page, 'Kitchen').getByRole('button', { name: /Remove/ })).toHaveCount(0);

			await gotoHydrated(page, url('/utils'));
			await expect(toolLinks(page)).toHaveText([
				/Notes/,
				/Dice/,
				/Units/,
				/Camera/,
				/QR code/,
				/Journal/
			]);
			await gotoHydrated(page, url('/'));
			await expect(page.getByTestId('pinned')).toHaveCount(0);

			// The page still opens, with a notice.
			await gotoHydrated(page, url('/utils/coffee'));
			await expect(page.getByRole('heading', { level: 1, name: 'Coffee Timer' })).toBeVisible();
			const notice = page.getByTestId('app-off');
			await expect(notice).toContainText('Kitchen is turned off.');
			await notice.getByRole('button', { name: 'Turn on' }).click();
			await expect(notice).toHaveCount(0);
			await gotoHydrated(page, url('/'));
			await expect(page.getByTestId('pinned').getByRole('link')).toHaveText([/Coffee Timer/]);
			await gotoHydrated(page, url('/utils/dice'));
			await expect(page.getByTestId('app-off')).toHaveCount(0);
		});
	});
}

test.describe('at the root', () => {
	const build = fileURLToPath(new URL('../build', import.meta.url));
	let server: StaticServer;
	const url = (path: string) => server.url(path);

	test.beforeAll(async () => {
		server = await serveStatic(build, { base: '' });
	});
	test.afterAll(() => server.close());

	test("Remove data clears only an app's own groups, once it's off", async ({ page }) => {
		await gotoHydrated(page, url('/'));
		await page.evaluate(() => {
			localStorage.setItem('app:hello:count', '3');
			localStorage.setItem('app:hello:note:a', '"hi"');
			localStorage.setItem('app:hello:journal', '"mine"');
		});
		await gotoHydrated(page, url('/apps'));
		const hello = card(page, 'Hello');
		await expect(hello.getByRole('button', { name: /Remove/ })).toHaveCount(0);
		await toggle(page, 'Hello').click();
		page.once('dialog', (dialog) => {
			expect(dialog.message()).toContain("Remove Hello's saved data");
			void dialog.accept();
		});
		await hello.getByRole('button', { name: "Remove Hello's data" }).click();
		await expect(page.getByTestId('toast').last()).toHaveText("Removed Hello's data.");
		await expect(hello.getByRole('button', { name: /Remove/ })).toHaveCount(0);
		expect(
			await page.evaluate(() => [
				localStorage.getItem('app:hello:count'),
				localStorage.getItem('app:hello:note:a'),
				localStorage.getItem('app:hello:journal')
			])
		).toEqual([null, null, '"mine"']);
		// Its page still opens, with the notice.
		await gotoHydrated(page, url('/hello'));
		await expect(page.getByTestId('app-off')).toContainText('Hello is turned off.');
	});

	test('the switch follows another tab, and Settings links to the Apps page', async ({
		page,
		context
	}) => {
		await gotoHydrated(page, url('/apps'));
		const other = await context.newPage();
		await gotoHydrated(other, url('/utils'));
		await expect(toolLinks(other)).toHaveCount(8);
		await toggle(page, 'Kitchen').click();
		await expect(toolLinks(other)).toHaveCount(6);

		await gotoHydrated(other, url('/settings'));
		const link = other.getByTestId('apps-link');
		await expect(link).toContainText('2 of 3 on');
		await toggle(page, 'Kitchen').click();
		await expect(link).toContainText('3 of 3 on');
		await link.click();
		await expect(other).toHaveURL(url('/apps'));
	});

	test('the prerendered Apps page shows the apps that start on as on', async ({ page }) => {
		const html = await (await page.request.get(url('/apps'))).text();
		// Kitchen, Hello and Your apps.
		expect(html.match(/role="switch" aria-checked="true"/g)).toHaveLength(3);
	});

	test("an app's tab hides while it's off, from first paint, and comes back from another tab", async ({
		page,
		context
	}) => {
		const tab = (where: string) =>
			page.locator(`[data-shell-nav="${where}"]`).getByRole('link', { name: /Hello/ });
		await gotoHydrated(page, url('/apps'));
		await expect(tab('tabs')).toBeVisible();
		await toggle(page, 'Hello').click();
		await expect(tab('tabs')).toBeHidden();
		await expect(page.locator('html')).toHaveAttribute('data-apps-off', 'hello');
		// The other tabs share the bar between them.
		const settings = page
			.locator('[data-shell-nav="tabs"]')
			.getByRole('link', { name: /Settings/ });
		expect((await settings.boundingBox())!.width).toBeGreaterThan(390 / 3 - 2);

		// Header links (tablet portrait) and the sidebar (landscape).
		for (const viewport of [
			{ width: 820, height: 1180, where: 'header' },
			{ width: 1180, height: 820, where: 'sidebar' }
		]) {
			await page.setViewportSize(viewport);
			await expect(page.locator(`[data-shell-nav="${viewport.where}"]`)).toBeVisible();
			await expect(tab(viewport.where)).toBeHidden();
			await expect(
				page.locator(`[data-shell-nav="${viewport.where}"]`).getByRole('link', { name: /Utils/ })
			).toBeVisible();
		}
		await page.setViewportSize({ width: 390, height: 844 });

		// Before any app code runs (scripts blocked), the pre-paint script already hides it.
		const cold = await context.newPage();
		await cold.route('**/*.js', (route) => route.abort());
		await cold.goto(url('/utils'));
		await expect(cold.locator('html')).toHaveAttribute('data-apps-off', 'hello');
		await expect(
			cold.locator('[data-shell-nav="tabs"]').getByRole('link', { name: /Hello/ })
		).toBeHidden();
		await expect(
			cold.locator('[data-shell-nav="tabs"]').getByRole('link', { name: /Utils/ })
		).toBeVisible();
		await cold.close();

		const other = await context.newPage();
		await gotoHydrated(other, url('/apps'));
		await toggle(other, 'Hello').click();
		await expect(tab('tabs')).toBeVisible();
		await expect(page.locator('html')).toHaveAttribute('data-apps-off', '');
	});

	test('every control on the Apps page is a 44px tap target', async ({ page }) => {
		await gotoHydrated(page, url('/apps'));
		await toggle(page, 'Hello').click();
		await page.evaluate(() => localStorage.setItem('app:hello:count', '1'));
		await gotoHydrated(page, url('/apps'));
		await expect(card(page, 'Hello').getByRole('button', { name: /Remove/ })).toBeVisible();
		expect(await auditTapTargets(page)).toEqual([]);
	});
});
