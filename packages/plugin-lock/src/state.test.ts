import { createStorage, memoryStorage } from '@xcwds/core';
import { describe, expect, it } from 'vitest';
import { createLock, lockEntries } from './lock.js';

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
});
