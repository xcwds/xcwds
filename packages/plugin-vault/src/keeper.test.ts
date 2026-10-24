import { createStorage, memoryStorage } from '@xcwds/core';
import { describe, expect, it, vi } from 'vitest';
import { passcodeKeeper } from './keeper.js';
import { MIN_ITERATIONS } from './seal.js';
import { createVault } from './vault.js';

const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
const SECRET = 'cycle day 12';

/** A device and one tab on it: a sensitive note, the vault, and its keeper. */
function tab(adapter = memoryStorage()) {
	const storage = createStorage({ adapter, onError: vi.fn() });
	const note = storage
		.scope('diary')
		.entry('note', { label: 'Note', parse: text, sensitive: true });
	const vault = createVault(storage.scope('vault'), { onError: vi.fn() });
	const keeper = passcodeKeeper(vault, { iterations: MIN_ITERATIONS });
	return { adapter, storage, note, vault, keeper };
}

const dump = (adapter: ReturnType<typeof memoryStorage>) => [...adapter.data].flat().join('\n');

describe('the passcode keeper', () => {
	it('seals with the passcode set up, and opens with it on the next start', async () => {
		const t = tab();
		t.storage.write(t.note, SECRET);
		expect(await t.keeper.setUp('123456')).toBe(true);
		expect(t.vault.state).toEqual({ enabled: true, locked: false });
		expect(dump(t.adapter)).not.toContain('cycle');
		// The key's salt is its own, and the passcode is never saved.
		expect(dump(t.adapter)).not.toContain('123456');
		t.keeper.lock();
		expect(t.storage.read(t.note)).toBeUndefined();

		const next = tab(t.adapter);
		expect(await next.keeper.unlock('000000')).toBe(false);
		expect(await next.keeper.unlock('123456')).toBe(true);
		expect(next.storage.read(next.note)).toBe(SECRET);
		// Already open: nothing to do.
		expect(await next.keeper.unlock('123456')).toBe(true);
	});

	it('turns the vault on at the first unlock when it came after the passcode', async () => {
		const t = tab();
		t.storage.write(t.note, SECRET);
		expect(await t.keeper.unlock('123456')).toBe(true);
		expect(t.vault.state.enabled).toBe(true);
		expect(dump(t.adapter)).not.toContain('cycle');
		expect(t.storage.read(t.note)).toBe(SECRET);
	});

	it('changes the passcode, even from locked, sealing with a fresh salt', async () => {
		const t = tab();
		t.storage.write(t.note, SECRET);
		await t.keeper.setUp('123456');
		const salt = t.vault.salt();
		t.keeper.lock();
		expect(await t.keeper.change('000000', '654321')).toBe(false);
		expect(t.vault.salt()).toBe(salt);
		expect(await t.keeper.change('123456', '654321')).toBe(true);
		expect(t.vault.salt()).not.toBe(salt);

		const next = tab(t.adapter);
		expect(await next.keeper.unlock('123456')).toBe(false);
		expect(await next.keeper.unlock('654321')).toBe(true);
		expect(next.storage.read(next.note)).toBe(SECRET);
	});

	it('turns off by writing the plaintext back, and resets by dropping it unread', async () => {
		const t = tab();
		t.storage.write(t.note, SECRET);
		expect(await t.keeper.turnOff('123456')).toBe(true);
		await t.keeper.setUp('123456');
		t.keeper.lock();
		expect(await t.keeper.turnOff('000000')).toBe(false);
		expect(await t.keeper.turnOff('123456')).toBe(true);
		expect(t.vault.state.enabled).toBe(false);
		expect(t.adapter.data.get('app:diary:note')).toBe(JSON.stringify(SECRET));

		await t.keeper.setUp('123456');
		t.keeper.lock();
		t.keeper.reset();
		expect(t.vault.state.enabled).toBe(false);
		expect([...t.adapter.data.keys()].filter((k) => k.startsWith('app:vault:'))).toEqual([]);
		expect(t.storage.read(t.note)).toBeUndefined();
	});

	it('sets up again over a vault left on without a passcode', async () => {
		const t = tab();
		await t.keeper.setUp('123456');
		t.keeper.lock();
		expect(await t.keeper.setUp('654321')).toBe(true);
		expect(await tab(t.adapter).keeper.unlock('654321')).toBe(true);
	});
});
