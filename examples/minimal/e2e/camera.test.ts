// @xcwds/plugin-camera (#145) in examples/minimal, with Chromium's fake camera: /utils/camera
// shows `<Camera>` over `app.camera`.
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

const build = fileURLToPath(new URL('../build', import.meta.url));
let server: StaticServer;
const url = (path: string) => server.url(path);

test.beforeAll(async () => {
	server = await serveStatic(build);
});
test.afterAll(() => server.close());

/** Remembers the live video track, so a test can ask about it after the viewfinder lets go. */
const keepTrack = (page: Page) =>
	page.evaluate(() => {
		const video = document.querySelector('video')!;
		(window as unknown as { track: MediaStreamTrack }).track = (
			video.srcObject as MediaStream
		).getVideoTracks()[0]!;
	});
const trackState = (page: Page) =>
	page.evaluate(() => (window as unknown as { track: MediaStreamTrack }).track.readyState);

/** Makes the page hidden (or visible again) the way switching apps does. */
const setHidden = (page: Page, hidden: boolean) =>
	page.evaluate((hidden) => {
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => (hidden ? 'hidden' : 'visible')
		});
		document.dispatchEvent(new Event('visibilitychange'));
	}, hidden);

test('asks only on a tap, takes a photo with no metadata, and turns off when hidden', async ({
	page
}) => {
	const away: string[] = [];
	page.on('request', (request) => {
		const target = new URL(request.url());
		if (!['data:', 'blob:'].includes(target.protocol) && target.origin !== new URL(url('/')).origin)
			away.push(request.url());
	});
	await gotoHydrated(page, url('/utils/camera'));
	await expect(page.getByRole('heading', { level: 1, name: 'Camera' })).toBeVisible();
	// Off until asked: no stream on page load.
	await expect(page.locator('[data-state]')).toHaveAttribute('data-state', 'idle');
	await page.getByRole('button', { name: 'Turn on camera' }).click();
	await expect(page.locator('[data-state]')).toHaveAttribute('data-state', 'live');
	await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible();
	await keepTrack(page);
	expect(await trackState(page)).toBe('live');

	await page.getByRole('button', { name: 'Take photo' }).click();
	// The page reads the photo's bytes with `readMetadata`: a JPEG with nothing in it but pixels.
	await expect(page.getByTestId('photo')).toContainText('image/jpeg, no metadata');

	// Hidden: the camera is off (its light too); back: on again, with a new track.
	await setHidden(page, true);
	await expect.poll(() => trackState(page)).toBe('ended');
	await setHidden(page, false);
	await expect(page.locator('[data-state]')).toHaveAttribute('data-state', 'live');
	await keepTrack(page);

	// Leaving the page turns it off.
	await page.locator('header [data-shell-back]').click();
	await expect(page).toHaveURL(url('/utils'));
	await expect.poll(() => trackState(page)).toBe('ended');
	expect(away).toEqual([]);
});

test('photos are kept in the app: they survive a reload and clear with their group (#146)', async ({
	page
}) => {
	page.on('dialog', (dialog) => dialog.accept());
	await gotoHydrated(page, url('/utils/camera'));
	await expect(page.getByTestId('kept')).toHaveText('0 photos kept');
	await page.getByRole('button', { name: 'Turn on camera' }).click();
	await page.getByRole('button', { name: 'Take photo' }).click();
	await expect(page.getByTestId('kept')).toHaveText('1 photo kept');
	await expect(page.getByTestId('photo')).toBeVisible();
	await page.getByRole('button', { name: 'Take photo' }).click();
	await expect(page.getByTestId('kept')).toHaveText('2 photos kept');
	await page.reload();
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await expect(page.getByTestId('kept')).toHaveText('2 photos kept');

	await gotoHydrated(page, url('/settings'));
	// Counted as photos, each with its thumbnail; never in backups.
	const group = page.getByRole('listitem').filter({ hasText: 'Photos (thumbnails)' });
	await expect(group.getByTestId('files-note')).toHaveText([
		/^Photos: 2 files, /,
		/^Photos \(thumbnails\): 2 files, /
	]);
	await expect(group.getByTestId('backup-note')).toHaveText('Not in backups');
	await group.getByRole('button', { name: /^Clear/ }).click();
	await expect(group.getByTestId('files-note')).toHaveCount(0);
	await gotoHydrated(page, url('/utils/camera'));
	await expect(page.getByTestId('kept')).toHaveText('0 photos kept');
});

test('the grid opens a photo in the viewer; delete can be undone; a locked app shows none (#146)', async ({
	page
}) => {
	await gotoHydrated(page, url('/utils/camera'));
	await expect(page.getByTestId('photos')).toContainText('No photos yet.');
	await page.getByRole('button', { name: 'Turn on camera' }).click();
	for (const n of [1, 2, 3]) {
		await page.getByRole('button', { name: 'Take photo' }).click();
		await expect(page.getByTestId('kept')).toHaveText(
			n === 1 ? '1 photo kept' : `${n} photos kept`
		);
	}
	await page.getByRole('button', { name: 'Turn off camera' }).click();
	const tiles = page.getByRole('list', { name: 'Photos' }).getByRole('button');
	await expect(tiles).toHaveCount(3);
	// Each tile shows its thumbnail, from an object URL.
	await expect(tiles.locator('img[src^="blob:"]')).toHaveCount(3);

	// The newest first; arrow keys and buttons step through them.
	await tiles.first().click();
	const viewer = page.getByTestId('photo-viewer');
	await expect(viewer).toBeVisible();
	await expect(viewer.locator('img[src^="blob:"]')).toBeVisible();
	await expect(viewer.getByRole('button', { name: 'Previous photo' })).toBeDisabled();
	await page.keyboard.press('ArrowRight');
	await expect(viewer.getByRole('button', { name: 'Previous photo' })).toBeEnabled();
	await viewer.getByRole('button', { name: 'Next photo' }).click();
	await expect(viewer.getByRole('button', { name: 'Next photo' })).toBeDisabled();
	// A swipe right goes back one.
	const picture = viewer.locator('[role="presentation"]');
	await picture.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 50 });
	await picture.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 250 });
	await expect(viewer.getByRole('button', { name: 'Next photo' })).toBeEnabled();

	// Delete: the next one opens in its place, and Undo brings it back.
	await viewer.getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByTestId('kept')).toHaveText('2 photos kept');
	await expect(viewer).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(viewer).toBeHidden();
	await expect(tiles).toHaveCount(2);
	await page.getByTestId('photos-status').getByRole('button', { name: 'Undo' }).click();
	await expect(tiles).toHaveCount(3);
	await expect(page.getByTestId('kept')).toHaveText('3 photos kept');

	// Locked on this page (hidden with "Right away"): no grid and no object URLs.
	await gotoHydrated(page, url('/settings'));
	const lock = page.getByTestId('passcode-lock');
	await lock.getByRole('button', { name: 'Set a passcode' }).click();
	await lock.getByLabel('Passcode', { exact: true }).fill('246810');
	await lock.getByLabel('Same again').fill('246810');
	await lock.getByRole('button', { name: 'Save passcode' }).click();
	await lock.getByRole('radio', { name: 'Right away' }).check();
	const go = async (name: RegExp) => {
		await page.getByRole('link', { name: /Utils/ }).first().click();
		await page.getByRole('link', { name }).first().click();
	};
	await go(/Camera/);
	await tiles.first().click();
	await viewer.getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByTestId('kept')).toHaveText('2 photos kept');
	await viewer.getByRole('button', { name: 'Close' }).click();
	const undo = page.getByTestId('photos-status').getByRole('button', { name: 'Undo' });
	await expect(undo).toBeVisible();
	await setHidden(page, true);
	await setHidden(page, false);
	await expect(page).toHaveURL(url('/utils/camera'));
	await expect(page.getByTestId('photos')).toHaveCount(0);
	await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
	// Unlocked again (through the Journal, a private page): the photos are back, with no stale Undo.
	await go(/Journal/);
	await page.getByTestId('unlock').getByLabel('Passcode').fill('246810');
	await page.getByTestId('unlock').getByRole('button', { name: 'Unlock' }).click();
	await expect(page).toHaveURL(/\/utils\/journal$/);
	await go(/Camera/);
	await expect(tiles).toHaveCount(2);
	await expect(undo).toHaveCount(0);
});

/** Takes `count` photos and opens the newest in the viewer. */
async function openNewest(page: Page, count = 1) {
	await gotoHydrated(page, url('/utils/camera'));
	await page.getByRole('button', { name: 'Turn on camera' }).click();
	for (let n = 1; n <= count; n++) {
		await page.getByRole('button', { name: 'Take photo' }).click();
		await expect(page.getByTestId('kept')).toHaveText(
			n === 1 ? '1 photo kept' : `${n} photos kept`
		);
	}
	await page.getByRole('button', { name: 'Turn off camera' }).click();
	await page.getByRole('list', { name: 'Photos' }).getByRole('button').first().click();
	const viewer = page.getByTestId('photo-viewer');
	await expect(viewer.locator('img[src^="blob:"]')).toBeVisible();
	return viewer;
}

test('where files can’t be shared, Save downloads the photo and says once that it left (#146)', async ({
	page
}) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'canShare', { value: () => false });
	});
	const viewer = await openNewest(page, 2);
	const notice = viewer.getByTestId('viewer-notice');
	const download = page.waitForEvent('download');
	await viewer.getByRole('button', { name: 'Save' }).click();
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/^photo-\d{8}-\d{6}\.jpg$/);
	await expect(notice).toContainText('That photo is now outside this app');
	// Once: the next one leaves without saying it again.
	await viewer.getByRole('button', { name: 'Next photo' }).click();
	await expect(notice).toHaveText('');
	const again = page.waitForEvent('download');
	await viewer.getByRole('button', { name: 'Save' }).click();
	await again;
	await expect(notice).toHaveText('');
});

test('Share hands the clean photo to the share sheet; dismissing it says nothing (#146)', async ({
	page
}) => {
	await page.addInitScript(() => {
		const w = window as unknown as {
			shared: { name: string; type: string; size: number }[];
			dismiss: boolean;
		};
		w.shared = [];
		w.dismiss = true;
		Object.defineProperty(navigator, 'canShare', { value: () => true });
		Object.defineProperty(navigator, 'share', {
			value: async ({ files }: { files: File[] }) => {
				if (w.dismiss) throw new DOMException('Share canceled', 'AbortError');
				w.shared.push(...files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
			}
		});
	});
	const viewer = await openNewest(page);
	const notice = viewer.getByTestId('viewer-notice');
	await viewer.getByRole('button', { name: 'Share' }).click();
	await expect(notice).toHaveText('');
	await page.evaluate(() => ((window as unknown as { dismiss: boolean }).dismiss = false));
	await viewer.getByRole('button', { name: 'Share' }).click();
	await expect(notice).toContainText('That photo is now outside this app');
	const shared = await page.evaluate(() => (window as unknown as { shared: unknown[] }).shared);
	expect(shared).toEqual([
		{
			name: expect.stringMatching(/^photo-\d{8}-\d{6}\.jpg$/),
			type: 'image/jpeg',
			size: expect.any(Number)
		}
	]);
});

test('leaving right after the shutter lets the photo finish before the camera turns off', async ({
	page
}) => {
	// A slow full-resolution still, so Back lands while the photo is being taken.
	await page.addInitScript(() => {
		const take = ImageCapture.prototype.takePhoto;
		ImageCapture.prototype.takePhoto = async function (...args) {
			(window as unknown as { taking: boolean }).taking = true;
			await new Promise((resolve) => setTimeout(resolve, 1500));
			(window as unknown as { taking: boolean }).taking = false;
			return take.apply(this, args);
		};
	});
	await gotoHydrated(page, url('/utils/camera'));
	await page.getByRole('button', { name: 'Turn on camera' }).click();
	await expect(page.locator('[data-state]')).toHaveAttribute('data-state', 'live');
	await keepTrack(page);
	await page.getByRole('button', { name: 'Take photo' }).click();
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { taking: boolean }).taking))
		.toBe(true);
	await page.locator('header [data-shell-back]').click();
	await expect(page).toHaveURL(url('/utils'));
	// Still on while the photo is taken, then off.
	expect(await trackState(page)).toBe('live');
	await expect.poll(() => trackState(page)).toBe('ended');
});

test('without hardware zoom, the slider says digital zoom and the photo is the centre crop', async ({
	page
}) => {
	// Hide any zoom the fake camera reports, as Firefox and Safari do.
	await page.addInitScript(() => {
		const caps = MediaStreamTrack.prototype.getCapabilities;
		MediaStreamTrack.prototype.getCapabilities = function () {
			const all = { ...caps.call(this) } as MediaTrackCapabilities & { zoom?: unknown };
			delete all.zoom;
			return all;
		};
		// And the full-resolution path, so the photo is the viewfinder's frame.
		delete (window as { ImageCapture?: unknown }).ImageCapture;
	});
	await gotoHydrated(page, url('/utils/camera'));
	await page.getByRole('button', { name: 'Turn on camera' }).click();
	await expect(page.locator('[data-state]')).toHaveAttribute('data-state', 'live');
	const frame = await page.evaluate(() => {
		const video = document.querySelector('video')!;
		const { width = 0, height = 0 } = (video.srcObject as MediaStream)
			.getVideoTracks()[0]!
			.getSettings();
		return { width, height };
	});

	await page.getByRole('button', { name: 'Take photo' }).click();
	await expect(page.getByTestId('photo')).toContainText(`${frame.width} × ${frame.height}`);

	const slider = page.getByRole('slider', { name: /Digital zoom/ });
	// The fake camera sends 1920×1080 when asked: room for a 1.4× crop above 1 megapixel.
	await expect(slider).toBeVisible();
	await expect(page.getByText('Crops the picture; it adds no detail.')).toBeVisible();
	const max = Number(await slider.getAttribute('max'));

	// Two fingers spreading on the picture zoom it like the slider; pinching in zooms back out.
	const picture = page.locator('[data-zoom]');
	const finger = (type: string, pointerId: number, clientX: number) =>
		picture.dispatchEvent(type, {
			pointerId,
			pointerType: 'touch',
			clientX,
			clientY: 200,
			isPrimary: pointerId === 1
		});
	await finger('pointerdown', 1, 100);
	await finger('pointerdown', 2, 200);
	await finger('pointermove', 2, 220);
	await expect(slider).toHaveValue('1.2');
	await finger('pointermove', 2, 400);
	await expect(slider).toHaveValue(String(max));
	await finger('pointermove', 2, 150);
	await expect(slider).toHaveValue('1');
	await finger('pointerup', 2, 150);
	await finger('pointerup', 1, 100);
	// A mouse doesn't pinch (and can't leave a stale finger behind).
	await picture.dispatchEvent('pointerdown', { pointerId: 9, pointerType: 'mouse', clientX: 100 });
	await finger('pointerdown', 2, 200);
	await finger('pointermove', 2, 400);
	await expect(slider).toHaveValue('1');
	await finger('pointerup', 2, 400);

	await slider.fill(String(max));
	await expect(picture).toHaveAttribute('data-zoom', 'digital');
	await page.getByRole('button', { name: 'Take photo' }).click();
	const width = Math.round(frame.width / max);
	await expect(page.getByTestId('photo')).toContainText(`${width} ×`);
});

test('a blocked camera says where this browser unblocks it', async ({ page }) => {
	await page.addInitScript(() => {
		navigator.mediaDevices.getUserMedia = () =>
			Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
	});
	await gotoHydrated(page, url('/utils/camera'));
	await page.getByRole('button', { name: 'Turn on camera' }).click();
	await expect(page.locator('[data-state]')).toHaveAttribute('data-state', 'denied');
	await expect(page.getByText('Camera access is blocked.')).toBeVisible();
	// Playwright's Chromium on a computer.
	await expect(page.getByTestId('camera-help')).toHaveText(
		/Click the icon to the left of the address, set Camera to Allow/
	);
	// It can be tried again once allowed.
	await expect(page.getByRole('button', { name: 'Turn on camera' })).toBeVisible();
});
