// @xcwds/plugin-vault (#79, #149) in examples/minimal's base-path build (the only one with the
// vault): with a passcode set, photos are sealed in IndexedDB, unreadable while the app is
// locked, and shown again once it's unlocked; backups carry sensitive data only encrypted.
import { expect, test, type Page } from '@playwright/test';
import { gotoHydrated, serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// A per-file `launchOptions` replaces the config's, so this repeats its Chromium and flag.
test.use({
	viewport: { width: 390, height: 844 },
	permissions: ['camera'],
	launchOptions: {
		executablePath: process.env.CHROMIUM_PATH || undefined,
		args: ['--disable-gpu', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
	}
});

const build = fileURLToPath(new URL('../build-sub', import.meta.url));
let server: StaticServer;
const url = (path: string) => server.url(path);

test.beforeAll(async () => {
	server = await serveStatic(build, { base: '/sub' });
});
test.afterAll(() => server.close());

const CODE = '246810';

/** Every photo row in IndexedDB, read past the app: its type and whether its bytes are a JPEG. */
const rawPhotos = (page: Page) =>
	page.evaluate(async () => {
		const name = (await indexedDB.databases()).find((d) => d.name?.endsWith('blobs'))!.name!;
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const r = indexedDB.open(name);
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		const rows = await new Promise<{ collection: string; type: string; blob: Blob }[]>(
			(resolve, reject) => {
				const r = db.transaction('blobs').objectStore('blobs').getAll();
				r.onsuccess = () => resolve(r.result);
				r.onerror = () => reject(r.error);
			}
		);
		db.close();
		const out = [];
		for (const row of rows.filter((r) => r.collection.endsWith(':photos'))) {
			const head = new Uint8Array(await row.blob.slice(0, 3).arrayBuffer());
			out.push({ type: row.type, jpeg: head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff });
		}
		return out;
	});

const go = async (page: Page, name: RegExp) => {
	await page.getByRole('link', { name: /Utils/ }).first().click();
	await page.getByRole('link', { name }).first().click();
};

test('photos are unreadable in IndexedDB while locked, and show after unlocking (#149)', async ({
	page
}) => {
	await gotoHydrated(page, url('/utils/camera'));
	await page.getByRole('button', { name: 'Turn on camera' }).click();
	await page.getByRole('button', { name: 'Take photo' }).click();
	await expect(page.getByTestId('kept')).toHaveText('1 photo kept');
	await page.getByRole('button', { name: 'Turn off camera' }).click();
	expect(await rawPhotos(page)).toEqual([{ type: 'image/jpeg', jpeg: true }]);

	// Setting a passcode seals the photo already saved, in the background.
	await gotoHydrated(page, url('/settings'));
	const lock = page.getByTestId('passcode-lock');
	// Settings → Privacy says what a passcode would encrypt, then that it's encrypted (#79).
	const wording = page.getByTestId('lock-encryption');
	await expect(wording).toContainText("Setting a passcode also encrypts what's saved for");
	await expect(wording.locator('strong')).toContainText('Photos');
	await lock.getByRole('button', { name: 'Set a passcode' }).click();
	await lock.getByLabel('Passcode', { exact: true }).fill(CODE);
	await lock.getByLabel('Same again').fill(CODE);
	await lock.getByRole('button', { name: 'Save passcode' }).click();
	await expect(page.getByTestId('lock-status')).toHaveText('The passcode lock is on and unlocked.');
	await expect(wording).toContainText('is encrypted on this device with the passcode');
	await expect(wording).not.toContainText("doesn't encrypt");
	await expect
		.poll(() => rawPhotos(page))
		.toEqual([{ type: 'application/octet-stream', jpeg: false }]);

	// One taken now is sealed as it's saved.
	await go(page, /Camera/);
	await page.getByRole('button', { name: 'Turn on camera' }).click();
	await page.getByRole('button', { name: 'Take photo' }).click();
	await expect(page.getByTestId('kept')).toHaveText('2 photos kept');
	await page.getByRole('button', { name: 'Turn off camera' }).click();
	expect((await rawPhotos(page)).map((p) => p.jpeg)).toEqual([false, false]);

	// A new start is locked: the photos can't be read, here or in IndexedDB.
	await page.reload();
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
	expect((await rawPhotos(page)).map((p) => p.jpeg)).toEqual([false, false]);

	// Unlocked (through the Journal, a private page): both photos show.
	await go(page, /Journal/);
	await page.getByTestId('unlock').getByLabel('Passcode').fill(CODE);
	await page.getByTestId('unlock').getByRole('button', { name: 'Unlock' }).click();
	await expect(page).toHaveURL(/\/utils\/journal$/);
	await go(page, /Camera/);
	await expect(page.getByTestId('kept')).toHaveText('2 photos kept');
	await expect(page.getByRole('list', { name: 'Photos' }).locator('img[src^="blob:"]')).toHaveCount(
		2
	);

	// Turning the lock off writes them back as plain JPEGs.
	await page
		.getByRole('link', { name: /Settings/ })
		.first()
		.click();
	await lock.getByRole('button', { name: 'Turn off' }).click();
	await lock.getByLabel('Current passcode').fill(CODE);
	await page.getByTestId('lock-form').getByRole('button', { name: 'Turn off' }).click();
	await expect(lock.getByRole('button', { name: 'Set a passcode' })).toBeVisible();
	await expect(wording).toContainText('Setting a passcode also encrypts');
	expect(await rawPhotos(page)).toEqual([
		{ type: 'image/jpeg', jpeg: true },
		{ type: 'image/jpeg', jpeg: true }
	]);
});

/** Downloads what `button` saves and reads it as JSON. */
async function downloaded(page: Page, click: () => Promise<void>) {
	const download = page.waitForEvent('download');
	await click();
	return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
}

test('backups carry the journal encrypted, and import it with the passcode (#79)', async ({
	page
}) => {
	page.on('dialog', (dialog) => dialog.accept());
	await gotoHydrated(page, url('/utils/journal'));
	await page.getByLabel('Entry').fill('dear diary');
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('app:hello:journal')))
		.toBe('"dear diary"');

	await gotoHydrated(page, url('/settings'));
	const lock = page.getByTestId('passcode-lock');
	await lock.getByRole('button', { name: 'Set a passcode' }).click();
	await lock.getByLabel('Passcode', { exact: true }).fill(CODE);
	await lock.getByLabel('Same again').fill(CODE);
	await lock.getByRole('button', { name: 'Save passcode' }).click();
	await expect(page.getByTestId('lock-status')).toHaveText('The passcode lock is on and unlocked.');

	// Settings' backup: the journal only sealed, the rest as before.
	const backup = await downloaded(page, () =>
		page.getByRole('button', { name: 'Download backup' }).click()
	);
	expect(backup.format).toBe(3);
	expect(JSON.stringify(backup)).not.toContain('dear diary');
	expect(backup.data).not.toHaveProperty('app:hello:journal');
	expect(Object.keys(backup.sections.vault.groups)).toEqual(['journal']);

	// Locked, "Forgot passcode" offers a backup of only what's encrypted.
	await lock.getByRole('button', { name: 'Lock now' }).click();
	await expect(page.getByTestId('lock-status')).toContainText('Locked.');
	await page.getByRole('button', { name: 'Forgot passcode?' }).click();
	const sealed = await downloaded(page, () =>
		page.getByRole('button', { name: 'Download encrypted backup' }).click()
	);
	expect(sealed.data).toEqual({});
	expect(sealed.unclaimed).toEqual({});
	expect(Object.keys(sealed.sections.vault.groups)).toEqual(['journal']);
	expect(JSON.stringify(sealed)).not.toContain('dear diary');
	await page.getByTestId('lock-forgot').getByRole('button', { name: 'Cancel' }).click();

	// Unlocked again, with the journal emptied, the backup brings it back with the passcode.
	await go(page, /Journal/);
	await page.getByTestId('unlock').getByLabel('Passcode').fill(CODE);
	await page.getByTestId('unlock').getByRole('button', { name: 'Unlock' }).click();
	await expect(page).toHaveURL(/\/utils\/journal$/);
	await page.getByLabel('Entry').fill('');
	await page
		.getByRole('link', { name: /Settings/ })
		.first()
		.click();
	await page.getByLabel('Backup file').setInputFiles({
		name: 'sealed.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(sealed))
	});
	const preview = page.getByTestId('import-preview');
	const form = preview.getByTestId('import-sealed');
	await expect(form).toContainText('Journal');
	await expect(preview.getByRole('button', { name: 'Merge' })).toBeDisabled();
	// Replacing without opening it would clear the journal here: the preview says so.
	await expect(preview.getByTestId('replace-sealed')).toContainText('including Journal');
	await form.getByLabel(/Enter the passcode/).fill('000000');
	await form.getByRole('button', { name: 'Open' }).click();
	await expect(form.getByRole('alert')).toHaveText(
		"That isn't the passcode this backup was made with."
	);
	await form.getByLabel(/Enter the passcode/).fill(CODE);
	await form.getByRole('button', { name: 'Open' }).click();
	await expect(preview.getByRole('listitem')).toHaveText(['Journal']);
	await expect(preview.getByTestId('import-sealed')).toHaveCount(0);
	await expect(preview.getByTestId('replace-sealed')).toHaveCount(0);
	await preview.getByRole('button', { name: 'Merge' }).click();
	await expect(page.getByTestId('toast').filter({ hasText: 'Imported 1 item.' })).toBeVisible();

	await go(page, /Journal/);
	await expect(page.getByLabel('Entry')).toHaveValue('dear diary');
	// Still sealed on the device.
	expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(
		'dear diary'
	);
});
