// @xcwds/plugin-tools (#17) in examples/minimal, ported from xcwds.github.io's home-shortcuts
// test: pin tools from the index page, reorder and unpin them on Home, and Recently used.
import { expect, test, type Page } from '@playwright/test';
import {
	auditTapTargets,
	gotoHydrated,
	serveStatic,
	type StaticServer
} from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

test.use({ viewport: { width: 390, height: 844 } });

const pinned = (page: Page) => page.getByTestId('pinned').getByRole('link');
const recent = (page: Page) => page.getByTestId('recent').getByRole('link');

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

		test('the index page lists every tool, and each tool has its own page', async ({ page }) => {
			await gotoHydrated(page, url('/utils'));
			await expect(page.getByRole('heading', { level: 1, name: 'Utils' })).toBeVisible();
			await expect(page.getByTestId('tools').getByRole('link')).toHaveText([
				/Coffee Timer\s*A 90-second countdown\.$/,
				/Notes/,
				/Timer/,
				/Dice/,
				/Units/,
				/Journal/
			]);
			await page.getByRole('link', { name: /Dice/ }).click();
			await expect(page).toHaveURL(url('/utils/dice'));
			await expect(page.getByRole('heading', { level: 1, name: 'Dice' })).toBeVisible();
			await page.locator('header [data-shell-back]').click();
			await expect(page).toHaveURL(url('/utils'));
		});

		test('pin tools from the index page, reorder and unpin them on Home', async ({ page }) => {
			await gotoHydrated(page, url('/'));
			await expect(page.getByTestId('pinned')).toHaveCount(0);

			await gotoHydrated(page, url('/utils'));
			await page.getByRole('button', { name: 'Pin Coffee Timer to Home' }).click();
			await expect(page.getByTestId('toast')).toHaveText('Pinned to Home.');
			await page.getByRole('button', { name: 'Pin Dice to Home' }).click();
			await expect(page.getByRole('button', { name: 'Pin Coffee Timer to Home' })).toHaveAttribute(
				'aria-pressed',
				'true'
			);

			await gotoHydrated(page, url('/'));
			await expect(pinned(page)).toHaveText([/Coffee Timer$/, /Dice$/]);
			await page.getByRole('button', { name: 'Edit' }).click();
			await page.getByRole('button', { name: 'Move Dice up' }).click();
			await expect(pinned(page)).toHaveText([/Dice$/, /Coffee Timer$/]);
			expect(await auditTapTargets(page)).toEqual([]);

			// The order survives a reload.
			await page.reload();
			await expect(pinned(page)).toHaveText([/Dice$/, /Coffee Timer$/]);

			await page.getByRole('button', { name: 'Edit' }).click();
			await page.getByRole('button', { name: 'Unpin Coffee Timer' }).click();
			await expect(pinned(page)).toHaveText([/Dice$/]);

			// Pins one tap from Home.
			await pinned(page).first().click();
			await expect(page).toHaveURL(url('/utils/dice'));
		});

		test('a tool added at runtime on a shared page can be pinned, kept and removed (#160)', async ({
			page
		}) => {
			const saved = () => page.evaluate(() => localStorage.getItem('app:tools:shortcuts') ?? '');
			await gotoHydrated(page, url('/utils/notes'));
			await page.getByRole('button', { name: 'Add Groceries to tools' }).click();
			await page.locator('header [data-shell-back]').click();
			await expect(page).toHaveURL(url('/utils'));
			await page.getByRole('button', { name: 'Pin Groceries to Home' }).click();
			await page.getByRole('link', { name: /Groceries/ }).click();
			await expect(page).toHaveURL(url('/utils/notes#groceries'));
			// Recently used tells it apart from its page, Notes.
			await expect.poll(saved).toContain('"recent":["/utils/notes#groceries","/utils/notes"]');
			await page.getByRole('link', { name: 'Home' }).first().click();
			await expect(pinned(page)).toHaveText([/Groceries$/]);
			// Pinned, so not listed twice.
			await expect(recent(page)).toHaveText([/Notes$/]);

			// Reloaded, the tool isn't there until something adds it again, but its pin is kept.
			await page.reload();
			await expect(page.getByTestId('pinned')).toHaveCount(0);
			expect(await saved()).toContain('/utils/notes#groceries');
			await gotoHydrated(page, url('/utils/notes'));
			await page.getByRole('button', { name: 'Add Groceries to tools' }).click();
			await page.getByRole('link', { name: 'Home' }).first().click();
			await expect(pinned(page)).toHaveText([/Groceries$/]);

			// Removing the tool takes its pin and its place under Recently used with it.
			await pinned(page).first().click();
			await expect(page).toHaveURL(url('/utils/notes#groceries'));
			await page.getByRole('button', { name: 'Remove Groceries from tools' }).click();
			await expect(page.getByRole('button', { name: 'Add Groceries to tools' })).toBeVisible();
			await expect.poll(saved).not.toContain('groceries');
		});

		test('recently used shows the last three tools opened, newest first', async ({ page }) => {
			for (const path of [
				'/utils/coffee',
				'/hello',
				'/utils/notes',
				'/utils/journal',
				'/utils/dice',
				'/utils/units'
			]) {
				await gotoHydrated(page, url(path));
				// The visit is recorded once the app has booted, a moment after hydration.
				if (path !== '/hello' && path !== '/utils/journal')
					await expect
						.poll(() => page.evaluate(() => localStorage.getItem('app:tools:shortcuts') ?? ''))
						.toContain(`"${path}"`);
			}
			await gotoHydrated(page, url('/'));
			// The private Journal is never listed.
			await expect(recent(page)).toHaveText([/Units$/, /Dice$/, /Notes$/]);

			// A pinned tool isn't listed twice.
			await gotoHydrated(page, url('/utils'));
			await page.getByRole('button', { name: 'Pin Units to Home' }).click();
			// In-app navigation records visits too.
			await page.getByRole('link', { name: /Coffee Timer/ }).click();
			await expect(page.getByTestId('tool')).toBeVisible();
			await page.getByRole('link', { name: 'Home' }).first().click();
			await expect(recent(page)).toHaveText([/Coffee Timer$/, /Dice$/]);
		});

		test('shortcuts to tools that no longer exist are ignored', async ({ page }) => {
			await gotoHydrated(page, url('/'));
			await page.evaluate(() =>
				localStorage.setItem(
					'app:tools:shortcuts',
					JSON.stringify({
						pins: ['/utils/retired-tool', '/utils/coffee'],
						recent: ['/utils/retired-tool', '/utils/notes', '/utils/journal']
					})
				)
			);
			await page.reload();
			await expect(pinned(page)).toHaveText([/Coffee Timer$/]);
			await expect(recent(page)).toHaveText([/Notes$/]);
		});

		test('with storage blocked, opening a tool shows no save-failure toast', async ({ page }) => {
			await page.addInitScript(() => {
				Object.defineProperty(window, 'localStorage', {
					get() {
						throw new DOMException('blocked', 'SecurityError');
					}
				});
			});
			await gotoHydrated(page, url('/utils/notes'));
			await gotoHydrated(page, url('/utils/dice'));
			// Recording "Recently used" failed, but the user didn't save anything, so nothing to report.
			await page.waitForTimeout(300);
			await expect(page.getByTestId('toast')).toHaveCount(0);

			// Pinning is the user's own action, so its failure is still reported.
			await gotoHydrated(page, url('/utils'));
			await page.getByRole('button', { name: 'Pin Coffee Timer to Home' }).click();
			await expect(page.getByTestId('toast')).toContainText("Couldn't save");
		});

		test('the manifest lists shortcut tools, never private ones', async ({ request }) => {
			const manifest = await (await request.get(url('/manifest.webmanifest'))).json();
			expect(manifest.shortcuts).toEqual([
				{ name: 'Coffee Timer', description: 'A 90-second countdown.', url: `${base}/utils/coffee` }
			]);
		});
	});
}
