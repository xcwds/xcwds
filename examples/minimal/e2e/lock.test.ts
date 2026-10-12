// @xcwds/plugin-lock (#75) in examples/minimal: the Journal is a private page, Notes isn't.
import { expect, test, type Page } from '@playwright/test';
import { gotoHydrated, serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

const build = fileURLToPath(new URL('../build', import.meta.url));
let server: StaticServer;
const url = (path: string) => server.url(path);

test.beforeAll(async () => {
	server = await serveStatic(build);
});
test.afterAll(() => server.close());

/**
 * Makes the page hidden (or visible again) the way switching apps does, and reports the cover as
 * it stands right after the event, before the browser could paint anything else.
 */
const setHidden = (page: Page, hidden: boolean) =>
	page.evaluate((hidden) => {
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => (hidden ? 'hidden' : 'visible')
		});
		document.dispatchEvent(new Event('visibilitychange'));
		const cover = document.querySelector<HTMLElement>('[data-xcwds-cover]');
		const middle = document.elementFromPoint(innerWidth / 2, innerHeight / 3);
		// Out of sight means nothing of it is on top, whatever the app's CSS does with [hidden].
		if (!cover || getComputedStyle(cover).display === 'none') {
			if (cover && (middle === cover || cover.contains(middle))) return 'on top while hidden';
			return null;
		}
		const rect = cover.getBoundingClientRect();
		return {
			text: cover.textContent,
			icon: cover.querySelector('img')?.getAttribute('src') ?? null,
			covers: rect.width >= innerWidth && rect.height >= innerHeight,
			top:
				document.elementFromPoint(innerWidth / 2, innerHeight / 3) === cover ||
				cover.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 3))
		};
	}, hidden);

test('a private page is covered while the app is hidden, and only then', async ({ page }) => {
	await gotoHydrated(page, url('/utils/journal'));
	// Waiting out of sight, never over the page.
	expect(await setHidden(page, false)).toBeNull();
	const cover = await setHidden(page, true);
	expect(cover).toEqual({
		text: '',
		icon: expect.stringContaining('icon'),
		covers: true,
		top: true
	});
	expect(await setHidden(page, false)).toBeNull();
	await expect(page.getByTestId('tool')).toBeVisible();

	// Not on a page that isn't private.
	await gotoHydrated(page, url('/utils/notes'));
	expect(await setHidden(page, true)).toBeNull();
	await setHidden(page, false);
	expect(await page.locator('[data-xcwds-cover]').count()).toBe(0);
});

test('Settings → Privacy turns the cover off', async ({ page }) => {
	await gotoHydrated(page, url('/settings'));
	const privacy = page.getByTestId('settings-privacy');
	const toggle = privacy.getByRole('switch', { name: /Cover private pages in the app switcher/ });
	await expect(toggle).toBeChecked();
	await toggle.uncheck();
	await gotoHydrated(page, url('/utils/journal'));
	expect(await setHidden(page, true)).toBeNull();
});

test('text fields on a private page skip spellcheck and autocomplete; other pages keep them', async ({
	page
}) => {
	await gotoHydrated(page, url('/utils/journal'));
	const entry = page.getByLabel('Entry');
	await expect(entry).toHaveAttribute('spellcheck', 'false');
	await expect(entry).toHaveAttribute('autocomplete', 'off');
	await expect(entry).toHaveAttribute('autocapitalize', 'off');
	// A field's own value wins.
	const title = page.getByLabel('Title');
	await expect(title).toHaveAttribute('spellcheck', 'true');
	await expect(title).toHaveAttribute('autocomplete', 'off');
	// Fields added later too.
	await page.evaluate(() => {
		const field = document.createElement('textarea');
		field.id = 'later';
		document.querySelector('main')!.append(field);
	});
	await expect(page.locator('#later')).toHaveAttribute('spellcheck', 'false');

	// Navigating in the app to a page that isn't private.
	await page.getByRole('link', { name: /back/i }).first().click();
	await page.getByRole('link', { name: /Notes/ }).first().click();
	await expect(page).toHaveURL(/\/utils\/notes$/);
	const note = page.getByLabel('Note');
	await expect(note).toBeVisible();
	await expect(note).not.toHaveAttribute('spellcheck');
	await expect(note).not.toHaveAttribute('autocomplete');
});
