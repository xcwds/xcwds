// The "Switching cameras without a new prompt" cell of docs/camera.md (#143) for Chromium on a
// computer: two fake cameras, the camera permission granted as a person would, and no fake
// prompt UI (`--use-fake-ui-for-media-stream` would allow everything). A headless Chromium
// refuses a camera it would have to ask for, so the second camera opening means the one grant
// covered it. Without the grant the camera is refused, which shows the test can fail.
import { expect, test } from '@playwright/test';
import { serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';
import { probeSwitch } from './probes.js';

// A per-file `launchOptions` replaces the config's, so this repeats its Chromium and flag.
test.use({
	launchOptions: {
		executablePath: process.env.CHROMIUM_PATH || undefined,
		args: ['--disable-gpu', '--use-fake-device-for-media-stream=device-count=2']
	}
});

const build = fileURLToPath(new URL('../build', import.meta.url));
let server: StaticServer;

test.beforeAll(async () => {
	server = await serveStatic(build);
});
test.afterAll(() => server.close());

test('one camera grant covers every camera in Chromium, as docs/camera.md says', async ({
	page,
	context
}) => {
	await context.grantPermissions(['camera'], { origin: server.url('/') });
	await page.goto(server.url('/'));
	expect(await page.evaluate(probeSwitch)).toEqual({
		cameras: 2,
		first: 'opened',
		second: 'opened',
		different: true
	});
});

test('without the grant Chromium refuses the camera', async ({ page }) => {
	await page.goto(server.url('/'));
	expect(await page.evaluate(probeSwitch)).toMatchObject({
		first: 'NotAllowedError'
	});
});
