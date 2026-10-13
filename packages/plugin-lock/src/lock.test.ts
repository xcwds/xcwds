import { pluginMeta } from '@xcwds/core';
import { buildTestApp } from '@xcwds/testing';
import { describe, expect, it } from 'vitest';
import client from './client.js';
import lockFactory, { build } from './index.js';
import {
	CONCEALED,
	DEFAULT_LOCK,
	HYGIENE,
	concealScript,
	isPrivate,
	isTextField,
	needsUnlock,
	parseLock,
	resolveOptions
} from './options.js';
import { waitText } from './ui.js';

describe('options', () => {
	it('takes the unlock path', () => {
		expect(resolveOptions({})).toEqual({ unlock: '/unlock' });
		expect(resolveOptions({ unlock: '/locked/here' })).toEqual({ unlock: '/locked/here' });
		for (const unlock of ['unlock', '/', '/unlock/', '//evil.example', '/a b', 3])
			expect(() => resolveOptions({ unlock })).toThrowError(/`unlock` must be an app path/);
		expect(() => resolveOptions({ passcode: true })).toThrowError(/unknown option `passcode`/);
		expect(() => resolveOptions([])).toThrowError(/must be an object/);
		expect(lockFactory().name).toBe('@xcwds/plugin-lock');
	});
});

describe('the lock setting', () => {
	it('parses, with missing keys back to their defaults', () => {
		expect(parseLock({ cover: false })).toEqual({ ...DEFAULT_LOCK, cover: false });
		expect(parseLock({})).toEqual(DEFAULT_LOCK);
		expect(parseLock({ scope: 'app', autoLockMinutes: 0 })).toEqual({
			cover: true,
			scope: 'app',
			autoLockMinutes: 0
		});
		expect(parseLock({ cover: 'yes' })).toBeUndefined();
		expect(parseLock({ scope: 'everything' })).toBeUndefined();
		expect(parseLock({ autoLockMinutes: 2 })).toBeUndefined();
		expect(parseLock({ autoLockMinutes: '1' })).toBeUndefined();
		expect(parseLock(null)).toBeUndefined();
		expect(parseLock([])).toBeUndefined();
		expect(DEFAULT_LOCK).toEqual({ cover: true, scope: 'private', autoLockMinutes: 1 });
	});

	it('registers the field in the privacy section, and the build declares no network', async () => {
		const app = await buildTestApp({ plugins: [[client, {}]] });
		const field = app.settings.fields().find((f) => f.name === 'lock');
		expect(field).toMatchObject({ section: 'privacy', default: DEFAULT_LOCK });
		expect(app.settings.get().lock).toEqual(DEFAULT_LOCK);
		// app.lock, with its data in its own group and out of backups.
		expect(app.lock!.state).toMatchObject({ enabled: false, locked: false });
		const group = app.storage.groups().find((g) => g.id === 'lock')!;
		expect(group.entries.map((e) => [e.key, e.backup])).toEqual([
			['app:lock:verifier', false],
			['app:lock:attempts', false],
			['app:lock:off', false]
		]);
		expect(pluginMeta(build).network).toBe(false);
		expect(pluginMeta(client).network).toBe(false);
	});
});

describe('private pages', () => {
	it('counts only routes marked private', () => {
		const routes = {
			get: (path: string) =>
				({ '/journal': { private: true }, '/notes': {}, '/odd': { private: 'yes' } })[path] as
					{ private?: boolean } | undefined
		};
		expect(isPrivate(routes, '/journal')).toBe(true);
		expect(isPrivate(routes, '/notes')).toBe(false);
		expect(isPrivate(routes, '/odd')).toBe(false);
		expect(isPrivate(routes, '/missing')).toBe(false);
		expect(isPrivate(undefined, '/journal')).toBe(false);
	});

	it('protects fields that take typed text', () => {
		expect(isTextField('TEXTAREA', null)).toBe(true);
		expect(isTextField('INPUT', null)).toBe(true);
		expect(isTextField('input', 'Search')).toBe(true);
		expect(isTextField('input', 'checkbox')).toBe(false);
		expect(isTextField('input', 'range')).toBe(false);
		expect(isTextField('select', null)).toBe(false);
		expect(HYGIENE).toEqual({ spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' });
	});
});

describe('what a locked app keeps behind the unlock screen', () => {
	const routes = {
		get: (path: string) =>
			({ '/journal': { private: true } })[path] as { private?: boolean } | undefined
	};

	it('is the private pages, or every page but the unlock screen', () => {
		expect(needsUnlock(routes, '/journal', 'private', '/unlock')).toBe(true);
		expect(needsUnlock(routes, '/notes', 'private', '/unlock')).toBe(false);
		expect(needsUnlock(routes, '/notes', 'app', '/unlock')).toBe(true);
		expect(needsUnlock(routes, '/', 'app', '/unlock')).toBe(true);
		expect(needsUnlock(routes, '/unlock', 'app', '/unlock')).toBe(false);
		expect(needsUnlock(routes, '/unlock/', 'app', '/unlock')).toBe(false);
	});

	it('hides the page before first paint only while a passcode is set', () => {
		const script = concealScript('my-app:');
		expect(script).toContain('localStorage.getItem("my-app:lock:verifier")');
		const root = { attrs: {} as Record<string, string>, style: {} as Record<string, string> };
		const run = (stored: string | null) => {
			root.attrs = {};
			root.style = {};
			new Function('localStorage', 'document', script)(
				{ getItem: () => stored },
				{
					documentElement: {
						setAttribute: (k: string, v: string) => (root.attrs[k] = v),
						style: { setProperty: (k: string, v: string) => (root.style[k] = v) }
					}
				}
			);
		};
		run('{"kind":"digits"}');
		expect(root.attrs).toEqual({ [CONCEALED]: '' });
		expect(root.style).toEqual({ visibility: 'hidden' });
		run(null);
		expect(root.attrs).toEqual({});
	});

	it('says how long the wait is, rounded up', () => {
		expect(waitText(0)).toBe('1 s');
		expect(waitText(29_100)).toBe('30 s');
		expect(waitText(60_000)).toBe('1 min');
		expect(waitText(61_000)).toBe('2 min');
		expect(waitText(3_600_000)).toBe('1 h');
		expect(waitText(3_900_000)).toBe('1 h 5 min');
	});

	it('sends locked pages to the unlock screen and back', async () => {
		const app = await buildTestApp({ plugins: [[client, {}]] });
		const guard = (path: string) => app.hooks.firstNow('onNavigate', [{ path }, null], { path });
		// No passcode: nothing is locked, and the unlock screen sends you home.
		app.settings.set({ lock: { ...DEFAULT_LOCK, scope: 'app' } });
		expect(guard('/notes')).toBeUndefined();
		expect(guard('/unlock')).toBe('/');

		expect(await app.lock!.setUp('123456', 'digits')).toBeUndefined();
		app.lock!.lock();
		expect(guard('/unlock')).toBeUndefined();
		expect(guard('/notes')).toBe('/unlock');
		// Remembered once, in memory.
		expect(app.lockScreen!.next()).toBe('/notes');
		expect(app.lockScreen!.next()).toBe('/');
		expect(guard('/notes')).toBe('/unlock');
		expect(await app.lock!.unlock('123456')).toBe('ok');
		expect(guard('/notes')).toBeUndefined();
		// Arriving at the unlock screen unlocked goes on to the page that was asked for.
		expect(guard('/unlock')).toBe('/notes');

		// Going somewhere else instead of unlocking forgets the page asked for.
		app.lock!.lock();
		expect(guard('/notes')).toBe('/unlock');
		app.settings.set({ lock: { ...DEFAULT_LOCK, scope: 'private' } });
		await app.hooks.run('afterNavigate', [{ path: '/' }], { path: '/' });
		expect(app.lockScreen!.next()).toBe('/');

		// Notices from a page the lock keeps out hide what they say while it's locked.
		app.settings.set({ lock: { ...DEFAULT_LOCK, scope: 'app' } });
		app.lock!.lock();
		expect(app.lock!.hides('/notes')).toBe(true);
		expect(app.lock!.hides('/unlock')).toBe(false);
		expect(app.lock!.hides(undefined)).toBe(false);
		await app.hooks.run('afterNavigate', [{ path: '/notes' }], { path: '/notes' });
		expect(app.lock!.here()).toBe('/notes');
		expect(await app.lock!.unlock('123456')).toBe('ok');
		expect(app.lock!.hides('/notes')).toBe(false);

		// Private pages only (none in this app without routes).
		app.settings.set({ lock: { ...DEFAULT_LOCK, scope: 'private' } });
		app.lock!.lock();
		expect(guard('/notes')).toBeUndefined();
		expect(app.lockScreen!.path).toBe('/unlock');
		await app.close();
	});
});
