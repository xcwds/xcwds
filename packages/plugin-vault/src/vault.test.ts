import { createStorage, memoryStorage, type StorageAdapter } from '@xcwds/core';
import { describe, expect, it, vi } from 'vitest';
import { MIN_ITERATIONS, deriveKey, newSalt } from './seal.js';
import { createVault } from './vault.js';

const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
const SECRET = 'cycle day 12';

function setup(adapter = memoryStorage(), onLocked?: () => void) {
	const storage = createStorage({ adapter, onError: vi.fn() });
	const diary = storage.scope('diary');
	const note = diary.entry('note', { label: 'Note', parse: text, sensitive: true });
	const mood = diary.entry('mood', { label: 'Mood', parse: text });
	const other = storage.scope('other').entry('n', { label: 'N', parse: text });
	const onError = vi.fn();
	const vault = createVault(storage.scope('vault'), { onError, onLocked });
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

	it('keeps a write that lands while enable is sealing', async () => {
		const { storage, adapter, note, vault } = setup();
		storage.write(note, SECRET);
		const { subtle } = globalThis.crypto;
		const encrypt = subtle.encrypt.bind(subtle);
		let wrote = false;
		const spy = vi.spyOn(subtle, 'encrypt').mockImplementation((...args) => {
			if (!wrote) {
				wrote = true;
				storage.write(note, 'written meanwhile');
			}
			return encrypt(...args);
		});
		const salt = newSalt();
		try {
			expect(await vault.enable(await key(salt), salt)).toBe(true);
		} finally {
			spy.mockRestore();
		}
		expect(wrote).toBe(true);
		expect(storage.read(note)).toBe('written meanwhile');
		expect(await vault.flush()).toBe(true);
		await Promise.resolve();
		expect(dump(adapter)).not.toContain('meanwhile');
		vault.lock();
		await vault.flush();
		expect(await vault.unlock(await key(salt))).toBe(true);
		expect(storage.read(note)).toBe('written meanwhile');
	});

	it('refuses a wrong key even with nothing sensitive saved', async () => {
		const { storage, note, vault } = setup();
		const salt = newSalt();
		expect(await vault.enable(await key(salt), salt)).toBe(true);
		vault.lock();
		expect(await vault.unlock(await key(salt, '000000'))).toBe(false);
		expect(vault.state.locked).toBe(true);
		expect(await vault.unlock(await key(salt))).toBe(true);
		expect(storage.write(note, SECRET)).toBe(true);
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

	it('seals everything again with a new key, and keeps a write made meanwhile', async () => {
		const { storage, adapter, note, mood, vault, salt } = await enabled();
		const salt2 = newSalt();
		const key2 = await key(salt2, '654321');
		const rekeying = vault.rekey(key2, salt2);
		storage.write(mood, 'calmer');
		expect(await rekeying).toBe(true);
		expect(vault.salt()).toBe(salt2);
		expect(await vault.flush()).toBe(true);
		expect(dump(adapter)).not.toContain('calm');
		const next = setup(adapter);
		expect(await next.vault.unlock(await key(salt))).toBe(false);
		expect(await next.vault.unlock(await key(salt2))).toBe(false);
		expect(await next.vault.unlock(key2)).toBe(true);
		expect(next.storage.read(next.note)).toBe(SECRET);
		expect(next.storage.read(next.mood)).toBe('calmer');
		expect(storage.read(note)).toBe(SECRET);
	});

	it("won't rekey while locked, and keeps the old key when storage refuses", async () => {
		const mem = memoryStorage();
		const full = { on: false };
		const adapter = {
			...mem,
			set(k: string, v: string) {
				if (full.on && k.startsWith('app:vault:'))
					throw new DOMException('full', 'QuotaExceededError');
				mem.set(k, v);
			}
		};
		const s = setup(adapter as ReturnType<typeof memoryStorage>);
		s.storage.write(s.note, SECRET);
		const salt = newSalt();
		expect(await s.vault.enable(await key(salt), salt)).toBe(true);
		const salt2 = newSalt();
		const key2 = await key(salt2, '654321');
		full.on = true;
		expect(await s.vault.rekey(key2, salt2)).toBe(false);
		full.on = false;
		expect(s.vault.salt()).toBe(salt);
		s.vault.lock();
		expect(await s.vault.rekey(key2, salt2)).toBe(false);
		expect(await s.vault.unlock(await key(salt))).toBe(true);
		expect(s.storage.read(s.note)).toBe(SECRET);
	});

	it("locks when another tab seals everything again, and doesn't save over it", async () => {
		const { adapter, salt } = await enabled();
		const onLocked = vi.fn();
		const a = setup(adapter, onLocked);
		const b = setup(adapter);
		const tab = new EventTarget();
		a.storage.startSync(tab);
		await a.vault.unlock(await key(salt));
		await b.vault.unlock(await key(salt));
		const salt2 = newSalt();
		const key2 = await key(salt2, '654321');
		expect(await b.vault.rekey(key2, salt2)).toBe(true);
		// Tab A writes before the event arrives: it isn't sealed over tab B's new key.
		a.storage.write(a.mood, 'from tab a');
		expect(await a.vault.flush()).toBe(true);
		tab.dispatchEvent(Object.assign(new Event('storage'), { key: 'app:vault:salt' }));
		expect(onLocked).toHaveBeenCalledOnce();
		expect(a.vault.state).toEqual({ enabled: true, locked: true });
		expect(a.storage.read(a.note)).toBeUndefined();
		expect(await a.vault.unlock(await key(salt))).toBe(false);
		expect(await a.vault.unlock(key2)).toBe(true);
		expect(a.storage.read(a.note)).toBe(SECRET);
		expect(a.storage.read(a.mood)).toBe('calm');
	});

	it('tells a tab that was open when another tab turned the vault on', async () => {
		const onLocked = vi.fn();
		const a = setup(memoryStorage(), onLocked);
		const tab = new EventTarget();
		a.storage.startSync(tab);
		a.storage.write(a.note, SECRET);
		const b = setup(a.adapter);
		const salt = newSalt();
		expect(await b.vault.enable(await key(salt), salt)).toBe(true);
		tab.dispatchEvent(Object.assign(new Event('storage'), { key: 'app:vault:salt' }));
		expect(onLocked).toHaveBeenCalledOnce();
		expect(a.vault.state).toEqual({ enabled: true, locked: true });
		expect(await a.vault.unlock(await key(salt))).toBe(true);
		expect(a.storage.read(a.note)).toBe(SECRET);
		// Its own key from then on: another salt event that changes nothing doesn't lock it.
		tab.dispatchEvent(Object.assign(new Event('storage'), { key: 'app:vault:salt' }));
		expect(onLocked).toHaveBeenCalledOnce();
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

/** Seals `text` with a files' key, and opens it with another, to tell whether they're the same. */
async function sameKey(a: CryptoKey, b: CryptoKey) {
	const iv = new Uint8Array(12);
	const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, a, new Uint8Array([1, 2, 3]));
	try {
		await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, b, data);
		return true;
	} catch {
		return false;
	}
}

const FILES = 'app:vault:files';

describe("the files' key (#149)", () => {
	it('is made when the vault is turned on, kept sealed, and only handed out while unlocked', async () => {
		const s = setup();
		expect(s.vault.fileKey()).toBeUndefined();
		const salt = newSalt();
		const k = await key(salt);
		expect(await s.vault.enable(k, salt)).toBe(true);
		const files = s.vault.fileKey()!;
		expect(files.extractable).toBe(false);
		expect(s.adapter.get(FILES)).toContain('"iv"');
		s.vault.lock();
		expect(s.vault.fileKey()).toBeUndefined();

		const next = setup(s.adapter);
		expect(await next.vault.unlock(k)).toBe(true);
		expect(await sameKey(files, next.vault.fileKey()!)).toBe(true);
	});

	it('stays the same across a new passcode', async () => {
		const { adapter, vault, salt } = await enabled();
		const before = vault.fileKey()!;
		const salt2 = newSalt();
		const key2 = await key(salt2, '654321');
		expect(await vault.rekey(key2, salt2)).toBe(true);
		expect(await sameKey(before, vault.fileKey()!)).toBe(true);
		const next = setup(adapter);
		expect(await next.vault.unlock(await key(salt))).toBe(false);
		expect(await next.vault.unlock(key2)).toBe(true);
		expect(await sameKey(before, next.vault.fileKey()!)).toBe(true);
	});

	it('opens the rest, without files, when its record was changed', async () => {
		const { adapter, vault, salt } = await enabled();
		const k = await key(salt);
		vault.lock();
		const changed = JSON.parse(adapter.get(FILES)!) as { data: string };
		changed.data = changed.data.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
		adapter.set(FILES, JSON.stringify(changed));
		const next = setup(adapter);
		expect(await next.vault.unlock(k)).toBe(true);
		expect(next.storage.read(next.note)).toBe(SECRET);
		expect(next.vault.fileKey()).toBeUndefined();
		expect(next.onError).toHaveBeenCalledOnce();
		// A new passcode still works, and leaves the record as it was (it opens with nothing).
		const salt2 = newSalt();
		expect(await next.vault.rekey(await key(salt2, '654321'), salt2)).toBe(true);
		expect(JSON.parse(adapter.get(FILES)!)).toEqual(changed);
	});

	it('gets one at unlock when the vault was turned on without', async () => {
		const { adapter, vault, salt } = await enabled();
		vault.lock();
		adapter.remove(FILES);
		const next = setup(adapter);
		expect(await next.vault.unlock(await key(salt))).toBe(true);
		const made = next.vault.fileKey()!;
		expect(adapter.get(FILES)).not.toBeNull();
		const third = setup(adapter);
		expect(await third.vault.unlock(await key(salt))).toBe(true);
		expect(await sameKey(made, third.vault.fileKey()!)).toBe(true);
	});

	it('goes when the vault is turned off or dropped', async () => {
		const a = await enabled();
		expect(await a.vault.disable()).toBe(true);
		expect(a.vault.fileKey()).toBeUndefined();
		expect(a.adapter.get(FILES)).toBeNull();
		const b = await enabled();
		b.vault.drop();
		expect(b.vault.fileKey()).toBeUndefined();
		expect(b.adapter.get(FILES)).toBeNull();
	});
});

describe('prefixed entries (#157)', () => {
	it('seals every id of a sensitive prefixed entry, and lists them only while unlocked', async () => {
		const adapter = memoryStorage();
		const storage = createStorage({ adapter, onError: vi.fn() });
		const days = storage
			.scope('diary')
			.entry('day', { label: 'Days', parse: text, prefix: true, sensitive: true });
		const vault = createVault(storage.scope('vault'), { onError: vi.fn() });
		storage.write(days.at('a'), SECRET);
		const salt = newSalt();
		expect(await vault.enable(await key(salt), salt)).toBe(true);
		storage.write(days.at('b'), 'cycle day 13');
		expect(await vault.flush()).toBe(true);
		expect(dump(adapter)).not.toContain('cycle');
		expect(storage.keys(days)).toEqual(['a', 'b']);
		vault.lock();
		expect(storage.keys(days)).toEqual([]);
		expect(storage.read(days.at('a'))).toBeUndefined();
		expect(storage.write(days.at('c'), 'nope')).toBe(false);
		expect(await vault.unlock(await key(salt))).toBe(true);
		expect(storage.read(days.at('b'))).toBe('cycle day 13');
		expect(storage.unclaimed()).toEqual([]);
	});
});
