import { defineConfig } from '@playwright/test';

// Firefox's ✅ cells in docs/camera.md (#143): `pnpm test:firefox` runs e2e-firefox/ in a Firefox
// you have installed (FIREFOX_PATH, else where Playwright looks for one), driven over WebDriver
// BiDi by Playwright's `moz-firefox` channel, with Firefox's fake camera and microphone. It isn't
// part of `test:e2e`: the channel is experimental, and Playwright doesn't pin that Firefox.
export default defineConfig({
	testDir: 'e2e-firefox',
	reporter: 'list',
	use: {
		browserName: 'firefox',
		channel: 'moz-firefox',
		launchOptions: {
			executablePath: process.env.FIREFOX_PATH || undefined,
			firefoxUserPrefs: {
				'media.navigator.streams.fake': true,
				'media.navigator.permission.disabled': true
			}
		}
	}
});
