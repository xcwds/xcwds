import { createBlobs, createStorage, memoryBlobs, memoryStorage } from '@xcwds/core';
import { describe, expect, it, vi } from 'vitest';
import { createLock, lockEntries, type PasscodeKeeper } from './lock.js';

/** A device: storage with the lock's entries, a sensitive journal and a plain setting. */
function device(adapter = memoryStorage(), clock = { t: 1_000_000 }) {
	const storage = createStorage({ adapter, appName: 'test' });
	const journal = storage
		.scope('journal')
		.entry('notes', { label: 'Journal', parse: (v) => v as string, sensitive: true });
	const prefs = storage.scope('prefs').entry('x', { label: 'Prefs', parse: (v) => v as number });
	const lockScope = storage.scope('lock');
	const entries = lockEntries(lockScope);
	const open = () => createLock(lockScope, entries, { now: () => clock.t, iterations: 100_000 });
	return { adapter, storage, journal, prefs, entries, open, clock };
}

describe('the lock', () => {
	it('sets up unlocked, starts locked, and unlocks with the passcode only', async () => {
		const d = device();
		const { lock } = d.open();
		expect(lock.state).toMatchObject({ enabled: false, locked: false });
		expect(await lock.setUp('123', 'digits')).toBe('Use at least 6 digits.');
		expect(await lock.setUp('123456', 'digits')).toBeUndefined();
		expect(lock.state).toMatchObject({ enabled: true, locked: false, kind: 'digits' });
		expect(await lock.setUp('654321', 'digits')).toMatch(/already set/);
		// The passcode is never saved, only the verifier.
		expect(JSON.stringify([...d.adapter.data.values()])).not.toContain('123456');

		// A reload: locked until the passcode.
		const { lock: next } = d.open();
		const seen: boolean[] = [];
		next.subscribe((s) => void seen.push(s.locked));
		expect(next.state.locked).toBe(true);
		expect(await next.unlock('000000')).toBe('wrong');
		expect(await next.unlock('123456')).toBe('ok');
		expect(next.state.locked).toBe(false);
		next.lock();
		expect(seen).toEqual([true, true, false, true]);
	});

	it('waits after five wrong tries, counted across reloads', async () => {
		const d = device();
		await d.open().lock.setUp('a good passphrase', 'passphrase');
		let { lock } = d.open();
		for (let i = 0; i < 4; i++) expect(await lock.unlock('nope')).toBe('wrong');
		({ lock } = d.open());
		expect(await lock.unlock('nope')).toBe('wrong');
		expect(lock.state.retryAt).toBe(d.clock.t + 30_000);
		// Even the right passcode isn't checked during the wait.
		expect(await lock.unlock('a good passphrase')).toBe('wait');
		expect(lock.state.locked).toBe(true);
		d.clock.t += 30_000;
		expect(await lock.unlock('a good passphrase')).toBe('ok');
		// The right one starts the count again.
		expect(d.adapter.data.has(d.entries.attempts.key)).toBe(false);
	});

	it('changes and turns off with the current passcode', async () => {
		const d = device();
		const { lock } = d.open();
		await lock.setUp('123456', 'digits');
		expect(await lock.change('123456', 'short', 'passphrase')).toBe('Use at least 8 characters.');
		expect(await lock.change('999999', 'new passphrase', 'passphrase')).toBe('wrong');
		expect(await lock.change('123456', 'new passphrase', 'passphrase')).toBe('ok');
		expect(lock.state.kind).toBe('passphrase');
		expect(await lock.turnOff('123456')).toBe('wrong');
		d.storage.write(d.journal, 'kept');
		expect(await lock.turnOff('new passphrase')).toBe('ok');
		expect(lock.state).toMatchObject({ enabled: false, locked: false });
		expect(d.storage.read(d.journal)).toBe('kept');
	});

	it('resets a forgotten passcode by clearing exactly the sensitive groups', async () => {
		const d = device();
		await d.open().lock.setUp('123456', 'digits');
		d.storage.write(d.journal, 'secret');
		d.storage.write(d.prefs, 3);
		const { lock } = d.open();
		expect(lock.sensitiveGroups().map((g) => g.label)).toEqual(['Journal']);
		expect(lock.reset().map((g) => g.id)).toEqual(['journal']);
		expect(d.storage.read(d.journal)).toBeUndefined();
		expect(d.storage.read(d.prefs)).toBe(3);
		expect(lock.state).toMatchObject({ enabled: false, locked: false });
	});

	it('clears sensitive blob collections too, and only those', async () => {
		const blobs = createBlobs({ backend: memoryBlobs() });
		const storage = createStorage({
			adapter: memoryStorage(),
			appName: 'test',
			collections: () => blobs.collections()
		});
		const photos = blobs
			.scope('camera')
			.register({ key: 'photos', label: 'Photos', sensitive: true });
		const icons = blobs.scope('icons').register({ key: 'cache', label: 'Icons' });
		await blobs.put(photos, new Blob(['p']));
		await blobs.put(icons, new Blob(['i']));
		const lockScope = storage.scope('lock');
		const entries = lockEntries(lockScope);
		const open = () => createLock(lockScope, entries, { iterations: 100_000, blobs });
		await open().lock.setUp('123456', 'digits');
		const { lock } = open();
		expect(lock.sensitiveGroups().map((g) => g.label)).toEqual(['Photos']);
		expect(lock.reset().map((g) => g.id)).toEqual(['camera']);
		await vi.waitFor(async () => expect(await blobs.list(photos)).toEqual([]));
		expect(await blobs.list(icons)).toHaveLength(1);
		blobs.stop();
	});

	it('clearing the passcode some other way clears the sensitive data too', async () => {
		const d = device();
		const { lock } = d.open();
		await lock.setUp('123456', 'digits');
		d.storage.write(d.journal, 'secret');
		d.storage.write(d.prefs, 3);
		// "Clear" on the lock's group in Settings → Your data.
		d.storage.clear(d.storage.groups().find((g) => g.id === 'lock')!.entries);
		expect(lock.state.enabled).toBe(false);
		expect(d.storage.read(d.journal)).toBeUndefined();
		expect(d.storage.read(d.prefs)).toBe(3);
	});

	it('turning the lock off in one tab keeps the data in the others', async () => {
		const d = device();
		await d.open().lock.setUp('123456', 'digits');
		d.storage.write(d.journal, 'kept');
		// Tab B: its own storage over the same device, following tab A through `storage` events.
		const b = device(d.adapter);
		const events = new EventTarget();
		b.storage.startSync(events);
		const { lock: inB } = b.open();
		const tell = (key: string) =>
			events.dispatchEvent(Object.assign(new Event('storage'), { key }));

		const { lock: inA } = d.open();
		expect(await inA.turnOff('123456')).toBe('ok');
		for (const key of [b.entries.off.key, b.entries.verifier.key]) tell(key);
		expect(inB.state.enabled).toBe(false);
		expect(b.storage.read(b.journal)).toBe('kept');

		// Cleared without a turn-off (another tab's "Clear" on the lock's data): wiped.
		expect(await inA.setUp('654321', 'digits')).toBeUndefined();
		tell(b.entries.verifier.key);
		expect(inB.state).toMatchObject({ enabled: true, locked: true });
		d.storage.clear(d.storage.groups().find((g) => g.id === 'lock')!.entries);
		tell(b.entries.verifier.key);
		expect(inB.state.enabled).toBe(false);
		expect(b.storage.read(b.journal)).toBeUndefined();
	});

	describe('a passcode keeper', () => {
		/** A keeper that records what it's told, and fails the steps named in `fail`. */
		function keeper(fail: string[] = []) {
			const told: string[] = [];
			const step =
				(name: string) =>
				async (...codes: string[]) => {
					told.push([name, ...codes].join(' '));
					return !fail.includes(name);
				};
			const k: PasscodeKeeper = {
				setUp: step('setUp'),
				unlock: step('unlock'),
				change: step('change'),
				turnOff: step('turnOff'),
				lock: () => void told.push('lock'),
				reset: () => void told.push('reset')
			};
			return { k, told };
		}

		it('is handed each passcode once the lock has checked it', async () => {
			const d = device();
			const { k, told } = keeper();
			let { lock } = d.open();
			lock.keep(k);
			expect(() => lock.keep(keeper().k)).toThrowError(/already has a passcode keeper/);
			expect(await lock.setUp('123', 'digits')).toBe('Use at least 6 digits.');
			expect(await lock.setUp('123456', 'digits')).toBeUndefined();
			lock.lock();
			expect(await lock.unlock('000000')).toBe('wrong');
			// The keeper opens before the lock does, so pages see what it opened.
			const seen: string[] = [];
			lock.subscribe((s) => void seen.push(`${s.locked} ${told.at(-1)}`));
			expect(await lock.unlock('123456')).toBe('ok');
			expect(seen.at(-1)).toBe('false unlock 123456');
			expect(await lock.change('000000', '654321', 'digits')).toBe('wrong');
			expect(await lock.change('123456', '654321', 'digits')).toBe('ok');
			expect(await lock.turnOff('654321')).toBe('ok');
			expect(told).toEqual([
				'setUp 123456',
				'lock',
				'unlock 123456',
				'change 123456 654321',
				'turnOff 654321'
			]);

			await lock.setUp('123456', 'digits');
			({ lock } = d.open());
			lock.keep(k);
			lock.reset();
			expect(told.slice(-2)).toEqual(['setUp 123456', 'reset']);
		});

		it('undoes a set-up, change or turn-off it failed', async () => {
			const d = device();
			const failing = keeper(['setUp', 'change', 'turnOff']);
			const { lock } = d.open();
			const stop = lock.keep(failing.k);
			expect(await lock.setUp('123456', 'digits')).toMatch(/Couldn't save/);
			expect(lock.state).toMatchObject({ enabled: false, locked: false });
			expect(d.adapter.data.has(d.entries.verifier.key)).toBe(false);

			// Set up without it, then the keeper refuses the change: the old passcode stays.
			stop();
			expect(await lock.setUp('123456', 'digits')).toBeUndefined();
			lock.keep(failing.k);
			expect(await lock.change('123456', '654321', 'digits')).toMatch(/Couldn't save/);
			expect(await lock.turnOff('654321')).toBe('wrong');
			expect(await lock.turnOff('123456')).toMatch(/Couldn't save/);
			expect(lock.state).toMatchObject({ enabled: true, locked: false });
			lock.lock();
			expect(await lock.unlock('123456')).toBe('ok');
		});

		it('a keeper that throws counts as one that failed, and a failed unlock still opens', async () => {
			const d = device();
			const { lock } = d.open();
			const stop = lock.keep({ setUp: () => Promise.reject(new Error('boom')) });
			expect(await lock.setUp('123456', 'digits')).toMatch(/Couldn't save/);
			stop();
			expect(await lock.setUp('123456', 'digits')).toBeUndefined();
			lock.keep({ unlock: async () => false, lock: () => {} });
			lock.lock();
			expect(await lock.unlock('123456')).toBe('ok');
			expect(lock.state.locked).toBe(false);
		});

		it("is reset when the passcode is cleared without its owner's say", async () => {
			const d = device();
			const { k, told } = keeper();
			const { lock } = d.open();
			lock.keep(k);
			await lock.setUp('123456', 'digits');
			d.storage.clear(d.storage.groups().find((g) => g.id === 'lock')!.entries);
			expect(told.at(-1)).toBe('reset');
			expect(lock.state.enabled).toBe(false);
		});
	});
});
