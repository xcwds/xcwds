// Your apps (@xcwds/plugin-blocks, #160) in examples/minimal: apps added from templates at
// /my-apps, run at /my-apps/app#<id> or, private, /my-apps/private#<id>, and built or edited at
// /my-apps/edit (#161); designs shared as links or files open at /my-apps/import (#162).
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

test('an app built from all four blocks works, and edits keep or drop its data as they say', async ({
	page
}) => {
	await gotoHydrated(page, url('/my-apps'));
	await page.getByRole('link', { name: 'New app' }).click();
	await expect(page).toHaveURL(url('/my-apps/edit'));
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/New app$/);
	const builder = page.getByTestId('builder');
	// A name comes first, inline.
	await builder.getByRole('button', { name: 'Save' }).click();
	await expect(builder.getByText('Give the app a name.')).toBeVisible();
	await builder.getByLabel('Name').fill('Home');
	await builder.getByRole('button', { name: 'Use 🌱' }).click();

	for (const type of ['checklist', 'counter', 'log', 'notes'])
		await builder.getByRole('button', { name: new RegExp(`^Add ${type}`) }).click();
	const blocks = builder.getByTestId('builder-block');
	await expect(blocks).toHaveCount(4);
	await expect(builder.getByRole('heading', { name: /Blocks/ })).toContainText('4 of 20');

	const checklist = blocks.nth(0);
	await checklist.getByLabel('Heading').fill('Plants');
	await checklist.getByRole('button', { name: 'Add item' }).click();
	await checklist.getByLabel('Item 1', { exact: true }).fill('Water the ferns');
	await checklist.getByLabel('Item 1 repeats').selectOption('daily');
	await checklist.getByRole('button', { name: 'Add item' }).click();
	await checklist.getByLabel('Item 2 repeats').selectOption('every');
	// Cleared and retyped, the number is what was typed.
	await checklist.getByLabel('Days between, item 2').fill('');
	await checklist.getByLabel('Days between, item 2').pressSequentially('4');
	await expect(checklist.getByLabel('Days between, item 2')).toHaveValue('4');

	const counter = blocks.nth(1);
	await counter.getByLabel('Heading').fill('Coffee');
	await counter.getByLabel('Goal').fill('3');
	await counter.getByLabel('Starts again').selectOption('daily');

	const log = blocks.nth(2);
	await log.getByLabel('Heading').fill('Health');
	await log.getByLabel('Label').fill('Weight');
	await log.getByLabel('Unit').fill('kg');
	await log.getByRole('button', { name: 'Add field' }).click();
	await expect(log.getByText('Fields (2 of 12)')).toBeVisible();
	await log.getByLabel('Type').nth(1).selectOption('yesno');
	await log.getByLabel('Label').nth(1).fill('Walked');
	// Moving keeps each field's settings.
	await log.getByRole('button', { name: 'Move field 2 up' }).click();
	await expect(log.getByLabel('Label').first()).toHaveValue('Walked');
	await expect(log.getByLabel('Unit')).toHaveValue('kg');

	// Removing a block can be undone.
	await blocks
		.nth(3)
		.getByRole('button', { name: /^Remove/ })
		.click();
	await expect(blocks).toHaveCount(3);
	await builder.getByRole('button', { name: 'Undo' }).click();
	await expect(blocks).toHaveCount(4);
	expect(await auditTapTargets(page)).toEqual([]);

	await builder.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(/\/my-apps\/app#/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Home$/);
	const app = page.getByTestId('blocks-app');
	await expect(app.getByRole('heading', { level: 2 })).toHaveText([
		'Plants',
		'Coffee',
		'Health',
		'Notes'
	]);
	await expect(app.getByText('Every 4 days')).toBeVisible();
	await app.getByRole('checkbox', { name: /Water the ferns/ }).check();
	await app.getByRole('button', { name: 'One more: Coffee' }).click();
	await expect(app.getByTestId('counter-value')).toHaveText('1 / 3');
	await app.getByLabel('Weight (kg)').fill('70');
	await app.getByRole('button', { name: 'Add entry' }).click();
	const entries = app.getByTestId('log-entry');
	await expect(entries.first()).toContainText(/Weight\s*70 kg/);

	// Renaming a field keeps its values.
	await app.getByTestId('blocks-edit').click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Edit Home$/);
	const healthLog = blocks.nth(2);
	await healthLog.getByLabel('Label').nth(1).fill('Body weight');
	await builder.getByRole('button', { name: 'Save' }).click();
	await expect(entries.first()).toContainText(/Body weight\s*70 kg/);

	// Removing a field that has values says what goes, and keeps it if you say no.
	const dialogs: string[] = [];
	let answer = false;
	page.on('dialog', (dialog) => {
		dialogs.push(dialog.message());
		void (answer ? dialog.accept() : dialog.dismiss());
	});
	await app.getByTestId('blocks-edit').click();
	await healthLog.getByRole('button', { name: 'Remove field 2' }).click();
	await builder.getByRole('button', { name: 'Save' }).click();
	expect(dialogs).toEqual([
		'Saving removes:\n\n• “Body weight” in “Health”, from 1 entry.\n\nSave?'
	]);
	await expect(page).toHaveURL(/\/my-apps\/edit#/);
	answer = true;
	await builder.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(/\/my-apps\/app#/);
	// The entry had nothing else, so it goes too; the rest is kept.
	await expect(entries).toHaveCount(0);
	await expect(app.getByTestId('counter-value')).toHaveText('1 / 3');
	await expect(app.getByRole('checkbox', { name: /Water the ferns/ })).toBeChecked();
});

test('a private app is edited on its own page, behind the lock like the app', async ({ page }) => {
	const id = await add(page, 'Mood');
	await page.getByTestId('blocks-edit').click();
	await expect(page).toHaveURL(url(`/my-apps/private-edit#${id}`));
	await expect(page).toHaveTitle('Edit private app · Minimal');
	// Opened on the normal builder page, it moves to the private one.
	await gotoHydrated(page, url(`/my-apps/edit#${id}`));
	await expect(page).toHaveURL(url(`/my-apps/private-edit#${id}`));
	// Turning it back into a normal app moves it.
	await page.getByTestId('builder').getByLabel('Private').uncheck();
	await page.getByTestId('builder').getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(url(`/my-apps/app#${id}`));
	await gotoHydrated(page, url('/my-apps/edit#nothing'));
	await expect(page.getByTestId('blocks-missing')).toBeVisible();
});

test('the builder keeps unsaved changes until Save or Discard, and previews without saving', async ({
	page
}) => {
	await gotoHydrated(page, url('/my-apps/edit'));
	const builder = page.getByTestId('builder');
	await builder.getByLabel('Name').fill('Garden');
	await builder.getByRole('button', { name: /^Add counter/ }).click();
	await builder.getByTestId('builder-block').getByLabel('Heading').fill('Watered');

	// Gone and back: the changes are still there.
	await gotoHydrated(page, url('/my-apps'));
	await page.getByRole('link', { name: 'New app' }).click();
	await expect(page.getByTestId('builder-restored')).toBeVisible();
	await expect(builder.getByLabel('Name')).toHaveValue('Garden');
	await expect(builder.getByTestId('builder-block').getByLabel('Heading')).toHaveValue('Watered');

	// Preview works, saves nothing, and goes back to the same changes.
	await builder.getByRole('button', { name: 'Preview' }).click();
	const preview = page.getByTestId('builder-preview');
	await expect(preview.getByRole('status')).toHaveText('Preview, nothing saved');
	await expect(preview.getByRole('heading', { level: 2 })).toHaveText(['Watered']);
	await preview.getByRole('button', { name: 'One more: Watered' }).click();
	await expect(preview.getByTestId('counter-value')).toHaveText('1');
	expect(await auditTapTargets(page)).toEqual([]);
	await preview.getByRole('button', { name: 'Back to editing' }).click();
	await expect(builder.getByLabel('Name')).toHaveValue('Garden');
	expect(
		await page.evaluate(() =>
			Object.keys(localStorage).filter((k) => k.startsWith('app:blocks:data'))
		)
	).toEqual([]);

	// Discard clears them.
	await builder.getByRole('button', { name: 'Discard changes' }).click();
	await expect(page).toHaveURL(url('/my-apps'));
	await page.getByRole('link', { name: 'New app' }).click();
	await expect(builder.getByLabel('Name')).toHaveValue('');
	await expect(page.getByTestId('builder-restored')).toHaveCount(0);

	// An app's edits come back after a reload, and Save clears them.
	const id = await add(page, 'Water');
	await page.getByTestId('blocks-edit').click();
	await builder.getByLabel('Name').fill('Water at work');
	await page.reload();
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await expect(builder.getByLabel('Name')).toHaveValue('Water at work');
	await builder.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(url(`/my-apps/app#${id}`));
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Water at work$/);
	await expect(page.getByText('Saved', { exact: true })).toBeVisible();
	expect(await page.evaluate(() => localStorage.getItem('app:blocks:draft'))).toBeNull();
});

test('an app can be built with the keyboard alone', async ({ page }) => {
	/** Tabs forward until `target` has focus, so it's reachable without a pointer. */
	async function tabTo(target: ReturnType<Page['locator']>) {
		for (let i = 0; i < 80; i++) {
			if (await target.evaluate((el) => el === document.activeElement)) return;
			await page.keyboard.press('Tab');
		}
		throw new Error(`Couldn't tab to ${String(target)}`);
	}
	await gotoHydrated(page, url('/my-apps'));
	await tabTo(page.getByRole('link', { name: 'New app' }));
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(url('/my-apps/edit'));
	const builder = page.getByTestId('builder');
	await tabTo(builder.getByLabel('Name'));
	await page.keyboard.type('Reading');
	await tabTo(builder.getByRole('button', { name: /^Add checklist/ }));
	await page.keyboard.press('Enter');
	const block = builder.getByTestId('builder-block');
	await tabTo(block.getByRole('button', { name: 'Add item' }));
	await page.keyboard.press('Space');
	await tabTo(block.getByLabel('Item 1', { exact: true }));
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type('One chapter');
	await tabTo(builder.getByRole('button', { name: 'Save' }));
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/\/my-apps\/app#/);
	await expect(page.getByRole('checkbox', { name: /One chapter/ })).toBeVisible();
	await tabTo(page.getByRole('checkbox', { name: /One chapter/ }));
	await page.keyboard.press('Space');
	await expect(page.getByTestId('checklist-progress')).toHaveText('1 of 1 done');
});

test("a private app's unsaved draft only comes back behind the lock", async ({ page }) => {
	const id = await add(page, 'Mood');
	await gotoHydrated(page, url('/my-apps/edit'));
	const builder = page.getByTestId('builder');
	await builder.getByLabel('Name').fill('Secret plan');
	await builder.getByLabel('Private').check();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('app:blocks:private-draft')))
		.toContain('Secret plan');

	await gotoHydrated(page, url('/settings'));
	const lock = page.getByTestId('passcode-lock');
	await lock.getByRole('button', { name: 'Set a passcode' }).click();
	await lock.getByLabel('Passcode', { exact: true }).fill('246810');
	await lock.getByLabel('Same again').fill('246810');
	await lock.getByRole('button', { name: 'Save passcode' }).click();
	await lock.getByRole('button', { name: 'Lock now' }).click();

	// The page for new apps isn't locked, so the draft goes to the private one, which is.
	await page.getByRole('link', { name: /Utils/ }).first().click();
	await page.getByTestId('your-apps-link').click();
	await page.getByRole('link', { name: 'New app' }).click();
	await expect(page).toHaveURL(/\/unlock$/);
	await expect(page.getByText('Secret plan')).toHaveCount(0);
	const screen = page.getByTestId('unlock');
	await screen.getByLabel('Passcode').fill('246810');
	await screen.getByRole('button', { name: 'Unlock' }).click();
	await expect(page).toHaveURL(url('/my-apps/private-edit'));
	await expect(page.getByTestId('builder-restored')).toBeVisible();
	await expect(builder.getByLabel('Name')).toHaveValue('Secret plan');

	// A private app opened on a normal page (each load starts locked) shows nothing of itself
	// and goes to the unlock screen.
	for (const path of [`/my-apps/app#${id}`, `/my-apps/edit#${id}`]) {
		await gotoHydrated(page, url(path));
		await expect(page, path).toHaveURL(/\/unlock$/);
		await expect(page.getByTestId('blocks-app')).toHaveCount(0);
		await expect(page.getByTestId('builder')).toHaveCount(0);
	}
});

test('a draft held back by the lock is kept, and comes back once unlocked', async ({ page }) => {
	const mood = await add(page, 'Mood');
	const water = await add(page, 'Water');
	await page.getByTestId('blocks-edit').click();
	const builder = page.getByTestId('builder');
	await builder.getByLabel('Name').fill('Private water');
	await builder.getByLabel('Private').check();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('app:blocks:private-draft')))
		.toContain('Private water');

	await gotoHydrated(page, url('/settings'));
	const lock = page.getByTestId('passcode-lock');
	await lock.getByRole('button', { name: 'Set a passcode' }).click();
	await lock.getByLabel('Passcode', { exact: true }).fill('246810');
	await lock.getByLabel('Same again').fill('246810');
	await lock.getByRole('button', { name: 'Save passcode' }).click();
	await lock.getByRole('button', { name: 'Lock now' }).click();

	// Locked, Water's builder shows Water as saved, and keeps the draft.
	await gotoHydrated(page, url(`/my-apps/edit#${water}`));
	await expect(builder.getByLabel('Name')).toHaveValue('Water');
	await expect(page.getByTestId('builder-restored')).toHaveCount(0);
	expect(await page.evaluate(() => localStorage.getItem('app:blocks:private-draft'))).toContain(
		'Private water'
	);

	// Unlocked (opening a private app asks), it comes back.
	await page.locator('header [data-shell-back]').click();
	await page.getByRole('link', { name: /Mood/ }).click();
	await page.getByTestId('unlock').getByLabel('Passcode').fill('246810');
	await page.getByTestId('unlock').getByRole('button', { name: 'Unlock' }).click();
	await expect(page).toHaveURL(url(`/my-apps/private#${mood}`));
	await page.locator('header [data-shell-back]').click();
	await expect(page).toHaveURL(url('/my-apps'));
	await page.locator('main').getByRole('link', { name: /Water/ }).first().click();
	await expect(page).toHaveURL(url(`/my-apps/app#${water}`));
	await page.getByTestId('blocks-edit').click();
	await expect(page.getByTestId('builder-restored')).toBeVisible();
	await expect(builder.getByLabel('Name')).toHaveValue('Private water');
});

test('a design shared as a link opens on another device, holding nothing saved', async ({
	page,
	browser
}) => {
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	const id = await add(page, 'Chores');
	await page.getByRole('checkbox').first().check();
	await gotoHydrated(page, url('/my-apps'));
	await page.getByRole('button', { name: 'Share design of Chores' }).click();
	const dialog = page.getByTestId('share-design');
	await expect(dialog).toBeVisible();
	expect(await auditTapTargets(page)).toEqual([]);
	await dialog.getByRole('button', { name: 'Copy link' }).click();
	await expect(page.getByText('Link copied.')).toBeVisible();
	const link = await page.evaluate(() => navigator.clipboard.readText());
	expect(link).toMatch(new RegExp(`^${url('/my-apps/import')}#app=[A-Za-z0-9_-]+$`));
	expect(link).not.toContain('?');

	// Someone else, with nothing saved.
	const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const theirs = await other.newPage();
	await gotoHydrated(theirs, link);
	await expect(theirs).toHaveURL(url('/my-apps/import'));
	const preview = theirs.getByTestId('import-preview');
	await expect(theirs.getByRole('note')).toContainText('Someone shared this app with you');
	await expect(preview.getByRole('heading', { name: /Chores/ })).toBeVisible();
	await expect(preview).toContainText('Checklist');
	expect(await auditTapTargets(theirs)).toEqual([]);
	// Nothing is added until Add app.
	expect(await theirs.evaluate(() => localStorage.getItem('app:blocks:apps'))).toBeNull();
	await theirs.getByRole('button', { name: 'Add app' }).click();
	await expect(theirs).toHaveURL(/\/my-apps\/app#/);
	const added = new URL(theirs.url()).hash.slice(1);
	expect(added).not.toBe(id);
	await expect(theirs.getByRole('checkbox').first()).not.toBeChecked();
	expect(
		await theirs.evaluate(() =>
			Object.keys(localStorage).filter((k) => k.startsWith('app:blocks:data'))
		)
	).toEqual([]);
	// Back from the app doesn't land on the import page with the design again.
	await theirs.goBack();
	await expect(theirs).not.toHaveURL(/#app=/);

	// A second import is a second app.
	await gotoHydrated(theirs, link);
	await theirs.getByRole('button', { name: 'Add app' }).click();
	await expect(theirs).toHaveURL(/\/my-apps\/app#/);
	await gotoHydrated(theirs, url('/my-apps'));
	await expect(theirs.getByTestId('your-apps').getByRole('listitem')).toHaveCount(2);
	await other.close();
});

test("a broken or foreign link says only that it can't be opened", async ({ page }) => {
	for (const data of ['nonsense', 'u.eyJmb3JtYXQiOjJ9', '']) {
		await gotoHydrated(page, url(`/my-apps/import#app=${data}`));
		await expect(page.getByTestId('import-error')).toHaveText(
			"This link doesn't contain an app this version can open."
		);
		await expect(page.getByTestId('import-preview')).toHaveCount(0);
		await expect(page).toHaveURL(url('/my-apps/import'));
	}
	// Cancel leaves nothing behind.
	await gotoHydrated(page, url('/my-apps'));
	await expect(page.getByTestId('your-apps-empty')).toBeVisible();
});

test('a design saved as a file is added from Your apps', async ({ page, browser }, testInfo) => {
	await add(page, 'Water');
	await gotoHydrated(page, url('/my-apps/edit#' + new URL(page.url()).hash.slice(1)));
	await page.getByTestId('builder').getByRole('button', { name: 'Share design' }).click();
	const dialog = page.getByTestId('share-design');
	await expect(dialog).toContainText('as last saved');
	const download = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Save as file' }).click();
	const file = await download;
	expect(file.suggestedFilename()).toBe('water.xcwds-app.json');
	const path = testInfo.outputPath(file.suggestedFilename());
	await file.saveAs(path);
	await dialog.getByRole('button', { name: 'Close' }).click();
	await expect(dialog).toBeHidden();

	const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const theirs = await other.newPage();
	await gotoHydrated(theirs, url('/my-apps'));
	await theirs.getByRole('link', { name: 'Add from a file' }).click();
	await expect(theirs).toHaveURL(url('/my-apps/import'));
	await theirs.getByLabel('Add an app from a file').setInputFiles({
		name: 'nope.json',
		mimeType: 'application/json',
		buffer: Buffer.from('{"format":1}')
	});
	await expect(theirs.getByTestId('import-error')).toHaveText(
		"This file doesn't contain an app this version can open."
	);
	// Too big to be a design: not even read.
	await theirs.getByLabel('Add an app from a file').setInputFiles({
		name: 'huge.json',
		mimeType: 'application/json',
		buffer: Buffer.alloc(64 * 1024 + 1, 32)
	});
	await expect(theirs.getByTestId('import-error')).toHaveText(
		"This file doesn't contain an app this version can open."
	);
	await theirs.getByLabel('Add an app from a file').setInputFiles(path);
	await expect(theirs.getByTestId('import-preview')).toContainText('Water');
	await theirs.getByRole('button', { name: 'Cancel' }).click();
	await expect(theirs).toHaveURL(url('/my-apps'));
	await expect(theirs.getByTestId('your-apps-empty')).toBeVisible();
	await other.close();
});

test('sharing a private app asks first', async ({ page }) => {
	await add(page, 'Mood');
	await gotoHydrated(page, url('/my-apps'));
	const asked: string[] = [];
	let answer = false;
	page.on('dialog', (d) => {
		asked.push(d.message());
		void (answer ? d.accept() : d.dismiss());
	});
	const share = page.getByRole('button', { name: 'Share design of Mood' });
	await share.click();
	expect(asked).toEqual([
		'"Mood" is private. Its name and fields will be visible to whoever gets the link or file. Share it anyway?'
	]);
	await expect(page.getByTestId('share-design')).toBeHidden();
	answer = true;
	await share.click();
	await expect(page.getByTestId('share-design')).toBeVisible();
	await expect(
		page.getByTestId('share-design').getByRole('button', { name: 'Copy link' })
	).toBeVisible();
});

test("a locked private app's design can't be shared", async ({ page }) => {
	await add(page, 'Mood');
	await add(page, 'Water');
	await gotoHydrated(page, url('/settings'));
	const lock = page.getByTestId('passcode-lock');
	await lock.getByRole('button', { name: 'Set a passcode' }).click();
	await lock.getByLabel('Passcode', { exact: true }).fill('246810');
	await lock.getByLabel('Same again').fill('246810');
	await lock.getByRole('button', { name: 'Save passcode' }).click();
	await lock.getByRole('button', { name: 'Lock now' }).click();

	await gotoHydrated(page, url('/my-apps'));
	await expect(page.getByRole('button', { name: 'Share design of Water' })).toBeVisible();
	await expect(page.getByTestId('your-apps')).toContainText('Mood');
	await expect(page.getByRole('button', { name: 'Share design of Mood' })).toHaveCount(0);

	// Unlocked (opening it asks), it can be shared.
	await page.getByRole('link', { name: /Mood/ }).click();
	await page.getByTestId('unlock').getByLabel('Passcode').fill('246810');
	await page.getByTestId('unlock').getByRole('button', { name: 'Unlock' }).click();
	await page.locator('header [data-shell-back]').click();
	await expect(page).toHaveURL(url('/my-apps'));
	await expect(page.getByRole('button', { name: 'Share design of Mood' })).toBeVisible();
});
