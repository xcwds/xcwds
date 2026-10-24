// @xcwds/plugin-vault (#79, #149) in examples/minimal's base-path build (the only one with the
// vault): with a passcode set, photos are sealed in IndexedDB, unreadable while the app is
// locked, and shown again once it's unlocked.
import { expect, test, type Page } from '@playwright/test';
import { gotoHydrated, serveStatic, type StaticServer } from '@xcwds/testing/playwright';
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
	await lock.getByRole('button', { name: 'Set a passcode' }).click();
	await lock.getByLabel('Passcode', { exact: true }).fill(CODE);
	await lock.getByLabel('Same again').fill(CODE);
	await lock.getByRole('button', { name: 'Save passcode' }).click();
	await expect(page.getByTestId('lock-status')).toHaveText('The passcode lock is on and unlocked.');
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
	expect(await rawPhotos(page)).toEqual([
		{ type: 'image/jpeg', jpeg: true },
		{ type: 'image/jpeg', jpeg: true }
	]);
});
