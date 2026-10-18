import { definePlugin } from '@xcwds/core';
import { buildTestApp, type Importer } from '@xcwds/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import client from './client.js';
import install from './index.js';
import { CATCH_PROMPT, PROMPT_GLOBAL, isIos, isStandalone, resolveOptions } from './options.js';

vi.mock('./InstallCard.svelte', () => ({ default: () => {} }));

afterEach(() => void vi.unstubAllGlobals());

const importer: Importer = async (id) => {
	const entries: Record<string, () => Promise<Record<string, unknown>>> = {
		'@xcwds/plugin-install': () => import('./index.js'),
		'@xcwds/plugin-install/client': () => import('./client.js')
	};
	const load = entries[id];
	if (!load) throw Object.assign(new Error(id), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
	return load();
};

const IPHONE =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

describe('platform detection', () => {
	it('knows iPhone and iPad, including iPadOS posing as a Mac', () => {
		expect(isIos(IPHONE, 5)).toBe(true);
		expect(isIos(IPAD_AS_MAC, 5)).toBe(true);
		expect(isIos(IPAD_AS_MAC, 0)).toBe(false); // a real Mac
		expect(isIos(ANDROID, 5)).toBe(false);
	});

	it('knows the installed app by its display mode, or by iOS navigator.standalone', () => {
		expect(isStandalone(true, undefined)).toBe(true);
		expect(isStandalone(false, true)).toBe(true);
		expect(isStandalone(false, false)).toBe(false);
		expect(isStandalone(false, 'yes')).toBe(false);
	});
});

describe('options', () => {
	it('has none, and says so', async () => {
		expect(resolveOptions()).toEqual({ text: {} });
		expect(() => resolveOptions({ name: 'x' })).toThrow(/unknown option `name`/);
		const steps = ['Open <strong>Safari</strong>.', 'Add it.'];
		const text = { heading: 'Install xcwds', iosSteps: steps };
		expect(resolveOptions({ text })).toEqual({ text });
		expect(resolveOptions({ text }).text.iosSteps).not.toBe(steps);
		expect(() => resolveOptions({ text: 'Install' })).toThrow(/`text`/);
		expect(() => resolveOptions({ text: { title: 'x' } })).toThrow(/unknown `text` key `title`/);
		expect(() => resolveOptions({ text: { heading: '' } })).toThrow(/`text.heading`/);
		expect(() => resolveOptions({ text: { iosSteps: [] } })).toThrow(/`text.iosSteps`/);
		expect(() => resolveOptions({ text: { iosSteps: ['ok', 3] } })).toThrow(/`text.iosSteps`/);
		await expect(
			buildTestApp({ plugins: [install({ nope: 1 } as never)] }, { import: importer })
		).rejects.toThrow(/@xcwds\/plugin-install: unknown option `nope`/);
	});
});

/** A prompt event that records being shown and answers `outcome`. */
function promptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
	const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
		shown: 0,
		prompt: async () => void event.shown++,
		userChoice: Promise.resolve({ outcome })
	});
	return event;
}

/** The browser around the app: a window, its display mode and the user agent. */
function fakeBrowser({ userAgent = ANDROID, standalone = false, touch = 5 } = {}) {
	const display = Object.assign(new EventTarget(), { matches: standalone });
	const win = Object.assign(new EventTarget(), {
		matchMedia: (query: string) =>
			query === '(display-mode: standalone)' ? display : { matches: false }
	}) as unknown as EventTarget & Record<string, unknown>;
	vi.stubGlobal('window', win);
	vi.stubGlobal('navigator', { userAgent, maxTouchPoints: touch });
	return {
		win,
		display,
		fire(event: Event) {
			win.dispatchEvent(event);
		}
	};
}

describe('the page', () => {
	it('leads the settings page with its card, in the words the config gives', async () => {
		fakeBrowser();
		const sections: unknown[] = [];
		const settingsPage = definePlugin(
			(app) =>
				void app.decorate('settingsPage', {
					add(component: unknown, options: unknown) {
						const section = { component, options };
						sections.push(section);
						return () => void sections.splice(sections.indexOf(section), 1);
					}
				} as never),
			{ name: 'settings-page', encapsulate: false }
		);
		const text = { heading: 'Install xcwds' };
		const app = await buildTestApp({ plugins: [settingsPage, [client, { text }]] });
		expect(app.install!.text).toEqual(text);
		await vi.waitFor(() => expect(sections).toHaveLength(1));
		expect(sections[0]).toMatchObject({ options: { order: -100 } });
		await app.close();
		expect(sections).toEqual([]);
	});

	it('checks the platform once it boots', async () => {
		fakeBrowser({ userAgent: IPHONE });
		const app = await buildTestApp({ plugins: [[client, {}]] });
		expect(app.install!.state).toEqual({
			checked: true,
			installed: false,
			available: false,
			ios: true
		});
		expect(await app.install!.prompt()).toBe('unavailable');
	});

	it('offers the prompt, shows it once from a tap, and hides once accepted', async () => {
		const browser = fakeBrowser();
		const app = await buildTestApp({ plugins: [[client, {}]] });
		const event = promptEvent();
		browser.fire(event);
		expect(event.defaultPrevented).toBe(true);
		expect(app.install!.state.available).toBe(true);
		expect(await app.install!.prompt()).toBe('accepted');
		expect(event.shown).toBe(1);
		expect(app.install!.state).toMatchObject({ available: false, installed: true });
		expect(await app.install!.prompt()).toBe('unavailable');
	});

	it('keeps offering nothing after a dismissed prompt until the browser offers again', async () => {
		const browser = fakeBrowser();
		const app = await buildTestApp({ plugins: [[client, {}]] });
		browser.fire(promptEvent('dismissed'));
		expect(await app.install!.prompt()).toBe('dismissed');
		expect(app.install!.state).toMatchObject({ available: false, installed: false });
		browser.fire(promptEvent());
		expect(app.install!.state.available).toBe(true);
	});

	it('keeps a prompt the browser refused to show (no user gesture)', async () => {
		const browser = fakeBrowser();
		const app = await buildTestApp({ plugins: [[client, {}]] });
		const event = promptEvent();
		event.prompt = () => Promise.reject(new DOMException('No gesture', 'NotAllowedError'));
		browser.fire(event);
		expect(await app.install!.prompt()).toBe('unavailable');
		expect(app.install!.state.available).toBe(true);
		event.prompt = async () => void event.shown++;
		expect(await app.install!.prompt()).toBe('accepted');
		expect(event.shown).toBe(1);
	});

	it('uses a prompt the head script caught before the app started', async () => {
		const browser = fakeBrowser();
		// The head script, as the build adds it.
		new Function(CATCH_PROMPT)();
		const event = promptEvent();
		browser.fire(event);
		expect(browser.win[PROMPT_GLOBAL]).toBe(event);
		const app = await buildTestApp({ plugins: [[client, {}]] });
		expect(browser.win[PROMPT_GLOBAL]).toBeUndefined();
		expect(app.install!.state.available).toBe(true);
		await app.install!.prompt();
		expect(event.shown).toBe(1);
	});

	it('offers nothing when running installed, or once the app is installed', async () => {
		fakeBrowser({ standalone: true });
		const installed = await buildTestApp({ plugins: [[client, {}]] });
		expect(installed.install!.state.installed).toBe(true);
		await installed.close();

		const browser = fakeBrowser();
		const app = await buildTestApp({ plugins: [[client, {}]] });
		browser.fire(promptEvent());
		browser.fire(new Event('appinstalled'));
		expect(app.install!.state).toMatchObject({ installed: true, available: false });
		expect(await app.install!.prompt()).toBe('unavailable');
	});

	it('notices the switch to standalone, and stops listening on close', async () => {
		const browser = fakeBrowser();
		const app = await buildTestApp({ plugins: [[client, {}]] });
		await app.close();
		browser.fire(promptEvent());
		expect(app.install!.state.available).toBe(false);

		const again = await buildTestApp({ plugins: [[client, {}]] });
		browser.display.matches = true;
		browser.display.dispatchEvent(new Event('change'));
		expect(again.install!.state.installed).toBe(true);
	});
});
