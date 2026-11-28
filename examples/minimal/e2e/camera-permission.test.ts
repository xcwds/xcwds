// The "Permission remembered" cell of docs/camera.md (#143) for Chromium on a computer: the
// browser is closed and launched again on the same profile, as a person quits and reopens it.
// Playwright's own grants (`permissions`, `grantPermissions`) and the fake prompt UI last only as
// long as the browser does, so they can't say what a person's answer does. Two answers can: the
// refusal a headless Chromium gives when it would have to ask, which it stores like a person's
// Block, and an Allow written into the profile the way Chrome stores "Allow on every visit".
import { expect, test, chromium, type BrowserContext } from '@playwright/test';
import { serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probePermission } from './probes.js';

const build = fileURLToPath(new URL('../build', import.meta.url));
let server: StaticServer;
let other: StaticServer;
let profile: string;

test.beforeAll(async () => {
	server = await serveStatic(build);
	// Another port is another site, so it shows the answer is kept per site.
	other = await serveStatic(build);
});
test.afterAll(() => Promise.all([server.close(), other.close()]));
test.beforeEach(async () => {
	profile = await mkdtemp(join(tmpdir(), 'xcwds-camera-permission-'));
});
test.afterEach(() => rm(profile, { recursive: true, force: true }));

/** Chromium on `profile`, with the fake camera and no fake prompt UI. */
function launch(): Promise<BrowserContext> {
	return chromium.launchPersistentContext(profile, {
		executablePath: process.env.CHROMIUM_PATH || undefined,
		args: ['--disable-gpu', '--use-fake-device-for-media-stream']
	});
}

async function probe(context: BrowserContext, url: string) {
	const page = await context.newPage();
	await page.goto(url);
	const result = await page.evaluate(probePermission);
	await page.close();
	return result;
}

/** The profile's stored camera answers, by site (`setting` 1 is Allow, 2 is Block). */
async function stored(): Promise<Record<string, { setting: number }>> {
	const prefs = JSON.parse(await readFile(join(profile, 'Default', 'Preferences'), 'utf8'));
	return prefs.profile?.content_settings?.exceptions?.media_stream_camera ?? {};
}

const site = (s: StaticServer) => `${new URL(s.url('/')).origin},*`;

test('Chromium remembers a refused camera per site after a relaunch, as docs/camera.md says', async () => {
	let context = await launch();
	expect(await probe(context, server.url('/'))).toEqual({
		state: 'prompt',
		camera: 'NotAllowedError'
	});
	await context.close();
	expect(await stored()).toEqual({ [site(server)]: expect.objectContaining({ setting: 2 }) });

	context = await launch();
	expect(await probe(context, server.url('/'))).toEqual({
		state: 'denied',
		camera: 'NotAllowedError'
	});
	expect((await probe(context, other.url('/'))).state).toBe('prompt');
	await context.close();
});

test('Chromium opens the camera after a relaunch for a site it stored Allow for, as docs/camera.md says', async () => {
	// A first launch creates the profile; then the Allow goes in while Chromium is closed.
	await (await launch()).close();
	const path = join(profile, 'Default', 'Preferences');
	const prefs = JSON.parse(await readFile(path, 'utf8'));
	prefs.profile.content_settings.exceptions.media_stream_camera = {
		[site(server)]: { setting: 1, last_modified: '13440000000000000' }
	};
	await writeFile(path, JSON.stringify(prefs));

	const context = await launch();
	expect(await probe(context, server.url('/'))).toEqual({ state: 'granted', camera: 'opened' });
	expect(await probe(context, other.url('/'))).toEqual({
		state: 'prompt',
		camera: 'NotAllowedError'
	});
	await context.close();
});
