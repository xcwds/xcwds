// @xcwds/plugin-settings (#20) in examples/minimal, ported from xcwds.github.io's settings and
// storage tests: every plugin's settings, backups, clearing data and About.
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { gotoHydrated, serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

test.use({ viewport: { width: 390, height: 844 } });

const scheme = (page: Page) => page.evaluate(() => document.documentElement.dataset.colorScheme);

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

		test('Settings is reachable from the tab bar, with About', async ({ page }) => {
			await gotoHydrated(page, url('/'));
			await page
				.getByRole('navigation', { name: 'Main' })
				.getByRole('link', { name: 'Settings' })
				.click();
			await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
			const about = page.getByTestId('about');
			await expect(about).toContainText('Minimal');
			await expect(about).toContainText('The smallest @xcwds app.');
			await expect(page.getByTestId('version')).not.toBeEmpty();
			await expect(about.getByRole('link', { name: 'github.com/xcwds/xcwds' })).toBeVisible();
			await expect(page.getByTestId('about-extra')).toHaveText('An example app for @xcwds.');
			// Sections plugins add: @xcwds/plugin-install's card leads the page.
			const sections = page.getByTestId('settings-page').locator(':scope > section');
			await expect(sections.first()).toHaveAttribute('data-testid', 'install');
		});

		test("plugins' settings show in their sections and apply", async ({ page }) => {
			await page.emulateMedia({ colorScheme: 'light' });
			await gotoHydrated(page, url('/settings'));
			const appearance = page.getByTestId('settings-appearance');
			await expect(appearance.getByRole('heading')).toHaveText('Appearance');
			await appearance.getByRole('radio', { name: 'Light' }).click();
			expect(await scheme(page)).toBe('light');
			// A real radio group: arrow keys move the choice.
			await expect(appearance.getByRole('radio', { name: 'Light' })).toBeFocused();
			await page.keyboard.press('ArrowRight');
			await expect(appearance.getByRole('radio', { name: 'Dark' })).toBeChecked();
			expect(await scheme(page)).toBe('dark');
			// The shell's own picker for its nav setting.
			await expect(appearance.getByTestId('nav-picker')).toBeVisible();

			await page.getByLabel('Alarm sound').uncheck();
			await page.reload();
			await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
			await expect(page.getByLabel('Alarm sound')).not.toBeChecked();
			await expect(page.getByLabel('Keep screen on')).toBeChecked();
			expect(await scheme(page)).toBe('dark');
		});

		test('export, clear and import a backup', async ({ page }) => {
			page.on('dialog', (dialog) => dialog.accept());
			await gotoHydrated(page, url('/utils'));
			await page.getByRole('button', { name: 'Pin Coffee Timer to Home' }).click();

			await gotoHydrated(page, url('/settings'));
			const downloadPromise = page.waitForEvent('download');
			await page.getByRole('button', { name: 'Download backup' }).click();
			const download = await downloadPromise;
			expect(download.suggestedFilename()).toMatch(/^minimal-backup-\d{4}-\d{2}-\d{2}\.json$/);
			const file = (await download.path())!;
			const backup = JSON.parse(await readFile(file, 'utf8'));
			expect(backup.app).toBe('Minimal');
			expect(backup.data['app:tools:shortcuts'].pins).toEqual(['/utils/coffee']);

			await page.getByRole('button', { name: 'Clear all data' }).click();
			await expect(
				page.getByTestId('toast').filter({ hasText: 'All data cleared.' })
			).toBeVisible();
			await expect(page.getByRole('button', { name: 'Clear Pinned tools' })).toBeDisabled();
			// Nothing writes itself straight back.
			await expect(page.getByRole('button', { name: 'Clear all data' })).toBeDisabled();
			expect(await page.evaluate(() => localStorage.length)).toBe(0);

			await page.getByLabel('Backup file').setInputFiles(file);
			const preview = page.getByTestId('import-preview');
			await expect(preview).toContainText('Home shortcuts');
			await preview.getByRole('button', { name: 'Merge' }).click();
			await expect(
				page.getByTestId('toast').filter({ hasText: /^Imported \d+ items?\.$/ })
			).toBeVisible();
			await expect(page.getByRole('button', { name: 'Clear Pinned tools' })).toBeEnabled();

			await page.getByRole('link', { name: 'Home' }).first().click();
			await expect(page.getByTestId('pinned').getByRole('link')).toHaveText([/Coffee Timer$/]);
		});

		test('data kept out of backups is noted, never exported or replaced, and still clears (#104)', async ({
			page
		}) => {
			page.on('dialog', (dialog) => dialog.accept());
			await gotoHydrated(page, url('/settings'));
			await page.evaluate(() => {
				localStorage.setItem('app:hello:count', '3');
				localStorage.setItem('app:hello:cache', '"kept"');
			});
			await page.reload();
			await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
			// (@xcwds/plugin-lock's passcode group is all out of backups, so it says just that.)
			await expect(page.getByTestId('backup-note')).toContainText(['Not in backups: Hello cache']);

			const downloadPromise = page.waitForEvent('download');
			await page.getByRole('button', { name: 'Download backup' }).click();
			const file = (await (await downloadPromise).path())!;
			const backup = JSON.parse(await readFile(file, 'utf8'));
			expect(backup.data['app:hello:count']).toBe(3);
			expect(JSON.stringify(backup)).not.toContain('app:hello:cache');

			await page.getByLabel('Backup file').setInputFiles(file);
			await page
				.getByTestId('import-preview')
				.getByRole('button', { name: 'Replace everything' })
				.click();
			await expect(page.getByTestId('toast').filter({ hasText: /^Imported/ })).toBeVisible();
			expect(await page.evaluate(() => localStorage.getItem('app:hello:cache'))).toBe('"kept"');

			await page.getByRole('button', { name: 'Clear all data' }).click();
			await expect(
				page.getByTestId('toast').filter({ hasText: 'All data cleared.' })
			).toBeVisible();
			expect(await page.evaluate(() => localStorage.getItem('app:hello:cache'))).toBeNull();
		});

		test('importing a file that is not a backup shows an error', async ({ page }) => {
			await gotoHydrated(page, url('/settings'));
			await page.getByLabel('Backup file').setInputFiles({
				name: 'notes.json',
				mimeType: 'application/json',
				buffer: Buffer.from(JSON.stringify({ hello: 'world' }))
			});
			await expect(page.getByRole('alert')).toHaveText("This file isn't a backup from this app.");
			await expect(page.getByTestId('import-preview')).toHaveCount(0);
		});

		// Ported from xcwds.github.io's home-shortcuts test.
		test('clearing Home shortcuts in Settings clears them for good', async ({ page }) => {
			await gotoHydrated(page, url('/utils'));
			await page.getByRole('button', { name: 'Pin Coffee Timer to Home' }).click();
			await gotoHydrated(page, url('/settings'));
			page.once('dialog', (dialog) => dialog.accept());
			await page.getByRole('button', { name: 'Clear Pinned tools' }).click();
			await expect(page.getByTestId('toast').last()).toHaveText('Cleared Pinned tools.');

			// The same tab (no reload) shows it unpinned, and pinning something else doesn't bring it back.
			await page.getByRole('link', { name: 'Utils' }).first().click();
			await expect(page.getByRole('button', { name: 'Pin Coffee Timer to Home' })).toHaveAttribute(
				'aria-pressed',
				'false'
			);
			await page.getByRole('button', { name: 'Pin Dice to Home' }).click();
			await page.getByRole('link', { name: 'Home' }).first().click();
			await expect(page.getByTestId('pinned').getByRole('link')).toHaveText([/Dice$/]);
		});

		test('`width: split` shows two columns of cards when they fit, and `groups` names and orders Your data', async ({
			page
		}) => {
			const sections = page.getByTestId('settings-page').locator(':scope > section');
			const lefts = async () =>
				new Set(await sections.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x)));
			await gotoHydrated(page, url('/settings'));
			expect((await lefts()).size).toBe(1);
			await page.setViewportSize({ width: 1440, height: 900 });
			await expect.poll(async () => (await lefts()).size).toBe(2);
			// Named groups come first.
			await expect(
				page.getByRole('button', { name: /^Clear (?!all)/ }).first()
			).toHaveAccessibleName('Clear Pinned tools');
		});

		test('with storage blocked, Settings says so and the app still works', async ({ page }) => {
			await page.addInitScript(() => {
				Object.defineProperty(window, 'localStorage', {
					get() {
						throw new DOMException('blocked', 'SecurityError');
					}
				});
			});
			const errors: string[] = [];
			page.on('pageerror', (e) => errors.push(e.message));
			await gotoHydrated(page, url('/settings'));
			await expect(page.getByTestId('storage-warning')).toBeVisible();
			await page.getByRole('radio', { name: 'Dark' }).click();
			expect(await scheme(page)).toBe('dark');
			expect(errors).toEqual([]);
		});
	});
}
