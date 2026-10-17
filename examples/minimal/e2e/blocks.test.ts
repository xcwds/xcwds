// Your apps (@xcwds/plugin-blocks, #160) in examples/minimal: apps added from templates at
// /my-apps, run at /my-apps/app#<id> or, private, /my-apps/private#<id>.
import { expect, test, type Page } from '@playwright/test';
import {
	auditTapTargets,
	gotoHydrated,
	serveStatic,
	type StaticServer
} from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

test.use({ viewport: { width: 390, height: 844 } });

const build = fileURLToPath(new URL('../build', import.meta.url));
let server: StaticServer;
const url = (path: string) => server.url(path);

test.beforeAll(async () => {
	server = await serveStatic(build);
});
test.afterAll(() => server.close());

/** Adds a template from Your apps, which opens it; returns its id. */
async function add(page: Page, name: string): Promise<string> {
	await gotoHydrated(page, url('/my-apps'));
	await page.getByRole('button', { name: new RegExp(`^Add ${name}`) }).click();
	await expect(page.getByTestId('blocks-app')).toBeVisible();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(new RegExp(`${name}$`));
	return (await page.getByTestId('blocks-app').getAttribute('data-app-id'))!;
}

test('a counter from a template counts, keeps its count, and joins the tools', async ({ page }) => {
	await gotoHydrated(page, url('/utils'));
	await page.getByTestId('your-apps-link').click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Your apps$/);
	await expect(page.getByTestId('your-apps-empty')).toBeVisible();

	const id = await add(page, 'Water');
	await expect(page).toHaveURL(url(`/my-apps/app#${id}`));
	await expect(page).toHaveTitle('Water · Minimal');
	const more = page.getByRole('button', { name: 'One more: Glasses today' });
	for (let i = 0; i < 3; i++) await more.click();
	await page.getByRole('button', { name: 'One less: Glasses today' }).click();
	await expect(page.getByTestId('counter-value')).toHaveText('2 / 8');
	await page.reload();
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await expect(page.getByTestId('counter-value')).toHaveText('2 / 8');
	expect(await auditTapTargets(page)).toEqual([]);

	// One of the tools: pinned on Home, and opened from there.
	await gotoHydrated(page, url('/utils'));
	await page.getByRole('button', { name: 'Pin Water to Home' }).click();
	await gotoHydrated(page, url('/'));
	await page.getByTestId('pinned').getByRole('link', { name: /Water/ }).click();
	await expect(page).toHaveURL(url(`/my-apps/app#${id}`));
	await expect(page.getByTestId('counter-value')).toHaveText('2 / 8');
	// The header goes back to Your apps.
	await page.locator('header [data-shell-back]').click();
	await expect(page).toHaveURL(url('/my-apps'));
	await expect(page.getByTestId('your-apps').getByRole('link')).toHaveText([/Water/]);
});

test('a checklist ticks items off and keeps them through a reload', async ({ page }) => {
	await add(page, 'Chores');
	await expect(page.getByTestId('checklist-progress')).toHaveText('0 of 4 done');
	await page.getByRole('checkbox', { name: /Dishes/ }).check();
	await expect(page.getByTestId('checklist-progress')).toHaveText('1 of 4 done');
	await expect(page.getByText('Every day · Back tomorrow')).toBeVisible();
	await page.reload();
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await expect(page.getByRole('checkbox', { name: /Dishes/ })).toBeChecked();
	await page.getByRole('checkbox', { name: /Dishes/ }).uncheck();
	await expect(page.getByTestId('checklist-progress')).toHaveText('0 of 4 done');
});

test('a private app logs entries and notes, deletes with Undo, and stays out of Recently used', async ({
	page
}) => {
	const id = await add(page, 'Mood');
	await expect(page).toHaveURL(url(`/my-apps/private#${id}`));
	// The header says Mood; the tab keeps the private page's own title.
	await expect(page).toHaveTitle('Private app · Minimal');

	// An empty entry is refused, inline.
	await page.getByRole('button', { name: 'Add entry' }).click();
	await expect(page.getByRole('alert')).toHaveText('Fill in at least one field.');
	await page.getByText('4', { exact: true }).click();
	await page.getByLabel('Sleep (h)').fill('7.5');
	await page.getByRole('textbox', { name: 'Note', exact: true }).fill('<b>fine</b>');
	await page.getByRole('button', { name: 'Add entry' }).click();
	const entries = page.getByTestId('log-entry');
	await expect(entries).toHaveCount(1);
	await expect(entries.first()).toContainText(/Mood\s*4 of 5/);
	await expect(entries.first()).toContainText(/Sleep\s*7.5 h/);
	// Text stays text.
	await expect(entries.first()).toContainText('<b>fine</b>');
	await expect(page.getByLabel('Sleep (h)')).toHaveValue('');

	await entries
		.first()
		.getByRole('button', { name: /Delete/ })
		.click();
	await expect(entries).toHaveCount(0);
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(entries).toHaveCount(1);

	await page.getByRole('textbox', { name: 'Notes' }).fill('slept badly on Tuesday');
	await page.getByRole('textbox', { name: 'Notes' }).blur();
	await page.reload();
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue('slept badly on Tuesday');
	await expect(entries).toHaveCount(1);
	expect(await auditTapTargets(page)).toEqual([]);

	// Opened on the normal page, it moves to the private one.
	await gotoHydrated(page, url(`/my-apps/app#${id}`));
	await expect(page).toHaveURL(url(`/my-apps/private#${id}`));
	await expect(page.getByTestId('blocks-app')).toBeVisible();

	await gotoHydrated(page, url('/'));
	await expect(page.getByTestId('recent').getByRole('link', { name: /Mood/ })).toHaveCount(0);
});

test('a log charts its numbers, as a table too, and edits an entry in place', async ({ page }) => {
	await add(page, 'Mood');
	const form = page.getByTestId('log-form');
	const sleep = form.getByLabel('Sleep (h)');
	for (const [mood, hours] of [
		['3', '6'],
		['5', '8']
	] as const) {
		await form.getByText(mood, { exact: true }).click();
		await sleep.fill(hours);
		await form.getByRole('button', { name: 'Add entry' }).click();
		await expect(sleep).toHaveValue('');
	}
	const entries = page.getByTestId('log-entry');
	await expect(entries).toHaveCount(2);

	const chart = page.locator('[data-testid="log-chart"][data-field="mood"]');
	await expect(chart.getByTestId('log-summary')).toHaveText(
		'Mood, last 7 days: latest 5, average 4, lowest 3, highest 5 (2 entries).'
	);
	await expect(chart.getByRole('img')).toHaveAttribute('aria-label', /latest 5/);
	await expect(chart.locator('circle')).toHaveCount(2);
	await chart.getByRole('button', { name: '30 days' }).click();
	await expect(chart.getByRole('button', { name: '30 days' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(chart.getByTestId('log-summary')).toContainText('last 30 days');
	await chart.getByRole('button', { name: 'Show as table' }).click();
	await expect(chart.locator('tbody tr')).toHaveCount(2);
	await expect(chart.locator('tbody tr').first()).toContainText('5 of 5');
	await expect(page.locator('[data-testid="log-chart"][data-field="slept"]')).toContainText(
		'latest 8 h'
	);

	// Edit the older entry: the form fills in, saving keeps its place and time.
	const older = entries.nth(1);
	const time = await older.locator('p').first().textContent();
	await older.getByRole('button', { name: /^Edit/ }).click();
	await expect(page.getByTestId('log-editing')).toBeVisible();
	await expect(sleep).toHaveValue('6');
	await expect(form.getByRole('radio', { name: '3' })).toBeChecked();
	await form.getByText('4', { exact: true }).click();
	await form.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByTestId('log-editing')).toHaveCount(0);
	await expect(entries).toHaveCount(2);
	await expect(entries.nth(1)).toContainText(/Mood\s*4 of 5/);
	await expect(entries.nth(1).locator('p').first()).toHaveText(time!);
	await expect(chart.getByTestId('log-summary')).toContainText('lowest 4');

	// Cancel leaves it as it was.
	await entries.nth(0).getByRole('button', { name: /^Edit/ }).click();
	await sleep.fill('1');
	await form.getByRole('button', { name: 'Cancel' }).click();
	await expect(sleep).toHaveValue('');
	await expect(entries.nth(0)).toContainText(/Sleep\s*8 h/);
	expect(await auditTapTargets(page)).toEqual([]);
});

test('notes typed in one app stay there when another app opens straight after', async ({
	page
}) => {
	const first = await add(page, 'Mood');
	const second = await add(page, 'Mood');
	await page.evaluate((id) => (location.hash = id), first);
	await expect(page.getByTestId('blocks-app')).toHaveAttribute('data-app-id', first);
	await page.getByRole('textbox', { name: 'Notes' }).pressSequentially('first only');
	// Before the typing is saved.
	await page.evaluate((id) => (location.hash = id), second);
	await expect(page.getByTestId('blocks-app')).toHaveAttribute('data-app-id', second);
	await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue('');
	const notes = (id: string) =>
		page.evaluate((id) => localStorage.getItem(`app:blocks:private:${id}`) ?? '', id);
	await expect.poll(() => notes(first)).toContain('first only');
	expect(await notes(second)).not.toContain('first only');
});

test("an app that isn't here says so; deleting one from the list can be undone", async ({
	page
}) => {
	// A malformed fragment names no app either.
	await gotoHydrated(page, url('/my-apps/app#%E0'));
	await expect(page.getByTestId('blocks-missing')).toBeVisible();
	await gotoHydrated(page, url('/my-apps/app#nothing'));
	await expect(page.getByTestId('blocks-missing')).toContainText("This app isn't on this device.");
	await page.getByTestId('blocks-missing').getByRole('link', { name: 'Your apps' }).click();
	await expect(page).toHaveURL(url('/my-apps'));

	const id = await add(page, 'Water');
	await gotoHydrated(page, url('/my-apps'));
	expect(await auditTapTargets(page)).toEqual([]);
	// How much they take up, each and all together.
	await expect(page.getByTestId('your-apps-usage')).toHaveText(
		/^Your apps use about \d+ bytes on this device\.$/
	);
	await expect(page.getByTestId('your-apps').getByRole('link')).toContainText(/\d+ bytes/);
	await expect(page.getByRole('alert')).toHaveCount(0);
	// Near the limit (data written straight to storage), it warns.
	await page.evaluate((id) => {
		const text = 'x'.repeat(4_000_000);
		localStorage.setItem(
			`app:blocks:data:${id}`,
			JSON.stringify({ format: 1, blocks: { glasses: { text } } })
		);
	}, id);
	await page.reload();
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await expect(page.getByTestId('your-apps-usage')).toContainText('about 4 MB');
	await expect(page.getByRole('alert')).toContainText('close to the space browsers give an app');
	const dialogs: string[] = [];
	page.on('dialog', (dialog) => {
		dialogs.push(dialog.message());
		void dialog.accept();
	});
	await page.getByRole('button', { name: 'Delete Water' }).click();
	expect(dialogs).toEqual(['Delete "Water" and everything saved in it?']);
	await expect(page.getByTestId('your-apps-empty')).toBeVisible();
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByTestId('your-apps').getByRole('link')).toHaveText([/Water/]);
});

test('a private app waits behind the passcode lock', async ({ page }) => {
	await add(page, 'Mood');
	await gotoHydrated(page, url('/settings'));
	const lock = page.getByTestId('passcode-lock');
	await lock.getByRole('button', { name: 'Set a passcode' }).click();
	await lock.getByLabel('Passcode', { exact: true }).fill('246810');
	await lock.getByLabel('Same again').fill('246810');
	await lock.getByRole('button', { name: 'Save passcode' }).click();
	await lock.getByRole('button', { name: 'Lock now' }).click();

	// Links only: every page load starts locked.
	await page.getByRole('link', { name: /Utils/ }).first().click();
	await page.getByTestId('your-apps-link').click();
	await page.getByRole('link', { name: /Mood/ }).click();
	await expect(page).toHaveURL(/\/unlock$/);
	await expect(page.getByTestId('blocks-app')).toHaveCount(0);
	const screen = page.getByTestId('unlock');
	await screen.getByLabel('Passcode').fill('246810');
	await screen.getByRole('button', { name: 'Unlock' }).click();
	await expect(page).toHaveURL(/\/my-apps\/private#/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Mood$/);
});
