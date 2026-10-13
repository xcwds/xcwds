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

// The passcode lock (#76).
const CODE = '246810';

/** Sets a passcode in Settings → Privacy (and picks what it locks, and when it locks itself). */
async function setUpLock(page: Page, { scope = '', auto = '' } = {}) {
	await gotoHydrated(page, url('/settings'));
	const lock = page.getByTestId('passcode-lock');
	await lock.getByRole('button', { name: 'Set a passcode' }).click();
	// Too short is refused, with the reason.
	await lock.getByLabel('Passcode', { exact: true }).fill('1234');
	await lock.getByLabel('Same again').fill('1234');
	await lock.getByRole('button', { name: 'Save passcode' }).click();
	await expect(page.getByTestId('lock-error')).toContainText('at least 6 digits');
	await lock.getByLabel('Passcode', { exact: true }).fill(CODE);
	await lock.getByLabel('Same again').fill(CODE);
	await lock.getByRole('button', { name: 'Save passcode' }).click();
	await expect(page.getByTestId('lock-status')).toHaveText('The passcode lock is on and unlocked.');
	if (scope) await lock.getByRole('radio', { name: scope }).check();
	if (auto) await lock.getByRole('radio', { name: auto }).check();
	return lock;
}

/**
 * Opens the Journal in the app. Once a passcode is set every page load starts locked, so these
 * tests navigate with links rather than `goto`.
 */
async function openJournal(page: Page) {
	await page.getByRole('link', { name: /Utils/ }).first().click();
	await page
		.getByRole('link', { name: /Journal/ })
		.first()
		.click();
}

async function unlock(page: Page, code = CODE) {
	const screen = page.getByTestId('unlock');
	await screen.getByLabel('Passcode').fill(code);
	await screen.getByRole('button', { name: 'Unlock' }).click();
}

test('a locked private page shows the unlock screen, then the page; the passcode is never saved', async ({
	page
}) => {
	const lock = await setUpLock(page);
	const saved = await page.evaluate(() => JSON.stringify({ ...localStorage }));
	expect(saved).toContain('app:lock:verifier');
	expect(saved).not.toContain(CODE);

	await lock.getByRole('button', { name: 'Lock now' }).click();
	await expect(page.getByTestId('lock-status')).toContainText('Locked.');
	// Backups would hand over what the lock keeps out.
	await expect(page.getByTestId('data-locked')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Download backup' })).toHaveCount(0);

	await openJournal(page);
	await expect(page).toHaveURL(/\/unlock$/);
	await expect(page.getByTestId('unlock')).toBeVisible();
	await expect(page.locator('h1')).toHaveText('Locked');
	const field = page.getByTestId('unlock').getByLabel('Passcode');
	await expect(field).toHaveAttribute('inputmode', 'numeric');
	await expect(field).toHaveAttribute('autocomplete', 'off');
	await expect(field).toBeFocused();

	await unlock(page, '000000');
	await expect(page.getByTestId('unlock')).toContainText('Wrong passcode.');
	await unlock(page);
	await expect(page).toHaveURL(/\/utils\/journal$/);
	await expect(page.getByTestId('tool')).toBeVisible();
	await page
		.getByRole('link', { name: /Settings/ })
		.first()
		.click();
	await expect(page.getByTestId('lock-status')).toHaveText('The passcode lock is on and unlocked.');
	await expect(page.getByTestId('data-locked')).toHaveCount(0);
});

test('every reload starts locked, and nothing of the page shows before the unlock screen', async ({
	page
}) => {
	await setUpLock(page);
	await openJournal(page);
	await page.getByLabel('Entry').fill('dear diary');
	// Saved (persist writes on change).
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('app:hello:journal')))
		.toBe('"dear diary"');

	// Hidden from the first paint: record what the page looked like before any app code ran.
	await page.addInitScript(() => {
		document.addEventListener('DOMContentLoaded', () => {
			(globalThis as { firstPaint?: string }).firstPaint = getComputedStyle(
				document.documentElement
			).visibility;
		});
	});
	await page.reload();
	await expect(page).toHaveURL(/\/unlock$/);
	await expect(page.getByTestId('unlock')).toBeVisible();
	expect(await page.evaluate(() => (globalThis as { firstPaint?: string }).firstPaint)).toBe(
		'hidden'
	);
	await expect(page.locator('html')).not.toHaveAttribute('data-xcwds-locked');
	await unlock(page);
	await expect(page).toHaveURL(/\/utils\/journal$/);
	await expect(page.getByLabel('Entry')).toHaveValue('dear diary');

	// A page that isn't locked shows once the app has booted.
	await page.goto(url('/utils/notes'));
	await expect(page.getByTestId('tool')).toBeVisible();
	await expect(page.locator('html')).not.toHaveAttribute('data-xcwds-locked');
});

test('wrong passcodes make you wait, even after a reload', async ({ page }) => {
	await setUpLock(page);
	await page.goto(url('/utils/journal'));
	await expect(page).toHaveURL(/\/unlock$/);
	const screen = page.getByTestId('unlock');
	for (let i = 0; i < 4; i++) {
		await unlock(page, `00000${i}`);
		await expect(screen).toContainText('Wrong passcode.');
		await expect(screen.getByLabel('Passcode')).toHaveValue('');
	}
	await unlock(page, '000004');
	await expect(screen).toContainText(/Too many wrong tries\. Try again in (30|29|28) s\./);
	await expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
	await page.reload();
	await expect(page.getByTestId('unlock')).toContainText(/Too many wrong tries/);
});

test('the whole app can be locked', async ({ page }) => {
	const lock = await setUpLock(page, { scope: 'The whole app' });
	await lock.getByRole('button', { name: 'Lock now' }).click();
	// Settings is locked too: the unlock screen replaces it.
	await expect(page).toHaveURL(/\/unlock$/);
	await page.goto(url('/hello'));
	await expect(page).toHaveURL(/\/unlock$/);
	await unlock(page);
	await expect(page).toHaveURL(/\/hello$/);
	await expect(page.getByTestId('plugin-page')).toBeVisible();
});

test('the app locks itself after being hidden', async ({ page }) => {
	await page.clock.install();
	await setUpLock(page);
	await openJournal(page);
	// Default: after a minute hidden, not sooner.
	await setHidden(page, true);
	await page.clock.fastForward(30_000);
	await setHidden(page, false);
	await expect(page.getByTestId('tool')).toBeVisible();
	await setHidden(page, true);
	await page.clock.fastForward(61_000);
	await setHidden(page, false);
	await expect(page).toHaveURL(/\/unlock$/);
	await unlock(page);
	await expect(page).toHaveURL(/\/utils\/journal$/);

	// "Right away": locked as soon as it's hidden, so the switcher never gets the page back.
	await page
		.getByRole('link', { name: /Settings/ })
		.first()
		.click();
	await page.getByTestId('passcode-lock').getByRole('radio', { name: 'Right away' }).check();
	await openJournal(page);
	await expect(page.getByTestId('tool')).toBeVisible();
	await setHidden(page, true);
	await expect(page).toHaveURL(/\/unlock$/);
	await setHidden(page, false);
	await expect(page.getByTestId('unlock')).toBeVisible();
});

test('forgot passcode clears only what the lock protects', async ({ page }) => {
	await setUpLock(page);
	await page.getByRole('link', { name: /Hello/ }).first().click();
	await page.getByTestId('count').click();
	await openJournal(page);
	await page.getByLabel('Entry').fill('dear diary');
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('app:hello:journal')))
		.toBe('"dear diary"');
	await page.reload();
	await expect(page).toHaveURL(/\/unlock$/);

	const forgot = page.getByTestId('lock-forgot');
	await forgot.getByRole('button', { name: 'Forgot passcode?' }).click();
	await expect(page.getByTestId('lock-forgot-groups')).toHaveText('Journal');
	await forgot.getByRole('button', { name: 'Reset the lock' }).click();
	await forgot.getByRole('button', { name: 'Clear and reset' }).click();
	await expect(page).toHaveURL(/\/utils\/journal$/);
	await expect(page.getByLabel('Entry')).toHaveValue('');
	const saved = await page.evaluate(() => ({ ...localStorage }));
	expect(saved['app:hello:journal']).toBeUndefined();
	expect(saved['app:lock:verifier']).toBeUndefined();
	expect(saved['app:hello:count']).toBe('1');
});
