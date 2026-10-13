import { pluginMeta } from '@xcwds/core';
import { buildTestApp } from '@xcwds/testing';
import { describe, expect, it } from 'vitest';
import client from './client.js';
import lockFactory, { build } from './index.js';
import {
	DEFAULT_LOCK,
	HYGIENE,
	isPrivate,
	isTextField,
	parseLock,
	resolveOptions
} from './options.js';

describe('options', () => {
	it('takes none yet', () => {
		expect(resolveOptions({})).toEqual({});
		expect(() => resolveOptions({ passcode: true })).toThrowError(/unknown option `passcode`/);
		expect(() => resolveOptions([])).toThrowError(/must be an object/);
		expect(lockFactory().name).toBe('@xcwds/plugin-lock');
	});
});

describe('the lock setting', () => {
	it('parses, with missing keys back to their defaults', () => {
		expect(parseLock({ cover: false })).toEqual({ cover: false });
		expect(parseLock({})).toEqual(DEFAULT_LOCK);
		expect(parseLock({ cover: 'yes' })).toBeUndefined();
		expect(parseLock(null)).toBeUndefined();
		expect(parseLock([])).toBeUndefined();
		expect(DEFAULT_LOCK.cover).toBe(true);
	});

	it('registers the field in the privacy section, and the build declares no network', async () => {
		const app = await buildTestApp({ plugins: [[client, {}]] });
		const field = app.settings.fields().find((f) => f.name === 'lock');
		expect(field).toMatchObject({ section: 'privacy', default: { cover: true } });
		expect(app.settings.get().lock).toEqual({ cover: true });
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
