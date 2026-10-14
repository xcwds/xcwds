import { createStorage, memoryStorage, type StorageAdapter } from '@xcwds/core';
import { describe, expect, it, vi } from 'vitest';
import { MIN_ITERATIONS, deriveKey, newSalt } from './seal.js';
import { createVault } from './vault.js';

const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
const SECRET = 'cycle day 12';

function setup(adapter = memoryStorage()) {
	const storage = createStorage({ adapter, onError: vi.fn() });
	const diary = storage.scope('diary');
	const note = diary.entry('note', { label: 'Note', parse: text, sensitive: true });
	const mood = diary.entry('mood', { label: 'Mood', parse: text });
	const other = storage.scope('other').entry('n', { label: 'N', parse: text });
	const onError = vi.fn();
	const vault = createVault(storage.scope('vault'), { onError });
	return { adapter, storage, note, mood, other, vault, onError };
}

const key = async (salt: string, code = '123456') => deriveKey(code, salt, MIN_ITERATIONS);

/** Everything the adapter holds, for scanning for plaintext. */
const dump = (adapter: ReturnType<typeof memoryStorage>) => [...adapter.data].flat().join('\n');

async function enabled() {
	const s = setup();
	s.storage.write(s.note, SECRET);
	s.storage.write(s.mood, 'calm');
	s.storage.write(s.other, 'plain');
	const salt = newSalt();
	expect(await s.vault.enable(await key(salt), salt)).toBe(true);
	return { ...s, salt };
}

describe('the vault', () => {
	it('is a pass-through until it is turned on', () => {
		const { storage, adapter, note, vault } = setup();
		expect(vault.state).toEqual({ enabled: false, locked: false });
		storage.write(note, SECRET);
		expect(adapter.data.get('app:diary:note')).toBe(JSON.stringify(SECRET));
		expect(vault.salt()).toBeUndefined();
	});

	it('seals sensitive groups on enable, leaving no plaintext and keeping the rest as it was', async () => {
		const { storage, adapter, note, mood, vault, salt } = await enabled();
		expect(vault.state).toEqual({ enabled: true, locked: false });
		expect(vault.salt()).toBe(salt);
		// The whole group is sensitive, so `mood` is sealed with `note`.
		expect(dump(adapter)).not.toContain('cycle');
		expect(dump(adapter)).not.toContain('calm');
		expect(adapter.data.get('app:other:n')).toBe('"plain"');
		expect(storage.read(note)).toBe(SECRET);
		expect(storage.read(mood)).toBe('calm');
		expect(storage.unclaimed()).toEqual([]);
	});

	it('keeps writes sealed, and refuses sensitive data while locked', async () => {
		const { storage, adapter, note, other, vault, salt } = await enabled();
		expect(storage.write(note, 'cycle day 13')).toBe(true);
		expect(await vault.flush()).toBe(true);
		expect(dump(adapter)).not.toContain('cycle');
		vault.lock();
		expect(vault.state.locked).toBe(true);
		expect(storage.read(note)).toBeUndefined();
		expect(storage.write(note, 'nope')).toBe(false);
		expect(storage.read(other)).toBe('plain');
		expect(await vault.unlock(await key(salt, '654321'))).toBe(false);
		expect(vault.state.locked).toBe(true);
		expect(await vault.unlock(await key(salt))).toBe(true);
		expect(storage.read(note)).toBe('cycle day 13');
	});

	it('saves a write made just before locking', async () => {
		const { storage, note, vault, salt } = await enabled();
		storage.write(note, 'last words');
		vault.lock();
		expect(await vault.flush()).toBe(true);
		expect(await vault.unlock(await key(salt))).toBe(true);
		expect(storage.read(note)).toBe('last words');
	});

	it('opens again on a fresh start (another registry over the same storage)', async () => {
		const { adapter, note, salt } = await enabled();
		const next = setup(adapter);
		expect(next.vault.state).toEqual({ enabled: true, locked: true });
		expect(next.storage.read(note)).toBeUndefined();
		expect(await next.vault.unlock(await key(salt))).toBe(true);
		expect(next.storage.read(next.note)).toBe(SECRET);
	});

	it('runs a migration that waited while locked once unlocked, and seals its result', async () => {
		const { adapter, salt } = await enabled();
		const storage = createStorage({ adapter, onError: vi.fn() });
		const diary = storage.scope('diary');
		diary.migration({
			to: 1,
			run(d) {
				d['app:diary:note'] = `${d['app:diary:note'] as string}!`;
			}
		});
		const note = diary.entry('note', { label: 'Note', parse: text, sensitive: true });
		diary.entry('mood', { label: 'Mood', parse: text });
		const vault = createVault(storage.scope('vault'));
		expect(storage.read(note)).toBeUndefined();
		expect(adapter.data.has('app:version:diary')).toBe(false);
		expect(await vault.unlock(await key(salt))).toBe(true);
		expect(storage.read(note)).toBe(`${SECRET}!`);
		expect(await vault.flush()).toBe(true);
		expect(adapter.data.get('app:version:diary')).toBe('1');
		expect(dump(adapter)).not.toContain('cycle');
	});

	it('seals plaintext of an entry that became sensitive after it was turned on', async () => {
		const { adapter, salt } = await enabled();
		adapter.data.set('app:journal:entry', JSON.stringify('dear diary'));
		const s = setup(adapter);
		const journal = s.storage.scope('journal').entry('entry', {
			label: 'Journal',
			parse: text,
			sensitive: true
		});
		expect(s.storage.read(journal)).toBeUndefined();
		expect(await s.vault.unlock(await key(salt))).toBe(true);
		expect(s.storage.read(journal)).toBe('dear diary');
		await s.vault.flush();
		await Promise.resolve();
		expect(dump(adapter)).not.toContain('dear diary');
	});

	it('turns off by writing the plaintext back', async () => {
		const { storage, adapter, note, vault } = await enabled();
		expect(await vault.disable()).toBe(true);
		expect(vault.state).toEqual({ enabled: false, locked: false });
		expect(adapter.data.get('app:diary:note')).toBe(JSON.stringify(SECRET));
		expect([...adapter.data.keys()].some((k) => k.startsWith('app:vault:'))).toBe(false);
		expect(storage.read(note)).toBe(SECRET);
	});

	it("won't turn off while locked", async () => {
		const { vault } = await enabled();
		vault.lock();
		expect(await vault.disable()).toBe(false);
		expect(vault.state.enabled).toBe(true);
	});

	it('drops everything sealed, unread, for a forgotten passcode', async () => {
		const { storage, adapter, note, other, vault } = await enabled();
		vault.lock();
		vault.drop();
		expect(vault.state).toEqual({ enabled: false, locked: false });
		expect([...adapter.data.keys()].filter((k) => k.startsWith('app:vault:'))).toEqual([]);
		expect(storage.read(note)).toBeUndefined();
		expect(storage.read(other)).toBe('plain');
	});

	it('drops the sealed groups when clearing removes the salt', async () => {
		const { storage, adapter, vault } = await enabled();
		vault.lock();
		const lockGroup = storage.groups().find((g) => g.id === 'lock')!;
		storage.clear(lockGroup.entries);
		// This tab's own clear reaches the listener as a change of the salt.
		expect(vault.state.enabled).toBe(false);
		expect([...adapter.data.keys()].filter((k) => k.startsWith('app:vault:'))).toEqual([]);
	});

	it("won't enable twice, and leaves nothing behind when storage is full", async () => {
		const { vault, salt } = await enabled();
		expect(await vault.enable(await key(salt), salt)).toBe(false);

		const mem = memoryStorage();
		const full = { on: false };
		const adapter: StorageAdapter = {
			...mem,
			set(k, v) {
				if (full.on) throw new DOMException('full', 'QuotaExceededError');
				mem.set(k, v);
			}
		};
		const fresh = createStorage({ adapter, onError: vi.fn() });
		const note = fresh
			.scope('diary')
			.entry('note', { label: 'Note', parse: text, sensitive: true });
		const v = createVault(fresh.scope('vault'));
		fresh.write(note, SECRET);
		full.on = true;
		const salt2 = newSalt();
		expect(await v.enable(await key(salt2), salt2)).toBe(false);
		expect(v.state.enabled).toBe(false);
		expect(mem.data.get('app:diary:note')).toBe(JSON.stringify(SECRET));
		expect([...mem.data.keys()].filter((k) => k.startsWith('app:vault:'))).toEqual([]);
	});

	it("opens another tab's re-seal", async () => {
		const { adapter, salt } = await enabled();
		const a = setup(adapter);
		const b = setup(adapter);
		const tab = new EventTarget();
		a.storage.startSync(tab);
		await a.vault.unlock(await key(salt));
		await b.vault.unlock(await key(salt));
		b.storage.write(b.note, 'from tab b');
		await b.vault.flush();
		const changes: unknown[] = [];
		a.storage.onChange((k) => changes.push(k));
		tab.dispatchEvent(Object.assign(new Event('storage'), { key: 'app:vault:sealed:diary' }));
		await vi.waitFor(() => expect(a.storage.read(a.note)).toBe('from tab b'));
		expect(changes).toContain(null);
	});

	it('reports a seal storage refused', async () => {
		const mem = memoryStorage();
		const full = { on: false };
		const adapter: StorageAdapter = {
			...mem,
			set(k, v) {
				if (full.on) throw new DOMException('full', 'QuotaExceededError');
				mem.set(k, v);
			}
		};
		const s = setup(adapter as ReturnType<typeof memoryStorage>);
		const salt = newSalt();
		await s.vault.enable(await key(salt), salt);
		full.on = true;
		s.storage.write(s.note, 'too big');
		expect(await s.vault.flush()).toBe(false);
		expect(s.onError).toHaveBeenCalledOnce();
		full.on = false;
		expect(await s.vault.flush()).toBe(true);
	});
});
