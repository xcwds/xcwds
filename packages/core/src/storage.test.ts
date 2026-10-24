import { describe, expect, it, vi } from 'vitest';
import { XcwdsError, codes } from './errors.js';
import { createStorage, memoryStorage, type StorageAdapter, type StorageLayer } from './storage.js';

const isNumber = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function setup(initial: Record<string, string> = {}, options: { appName?: string } = {}) {
	const adapter = memoryStorage(initial);
	const onError = vi.fn();
	const storage = createStorage({ adapter, onError, ...options });
	return { adapter, storage, onError };
}

/** An adapter whose every call throws, like blocked site data. */
const blocked: StorageAdapter = {
	get: () => {
		throw new DOMException('blocked', 'SecurityError');
	},
	set: () => {
		throw new DOMException('blocked', 'SecurityError');
	},
	remove: () => {
		throw new DOMException('blocked', 'SecurityError');
	},
	keys: () => {
		throw new DOMException('blocked', 'SecurityError');
	}
};

/** A memory adapter that throws on `set` while `full.on` is true (like a full localStorage). */
function fullable(initial: Record<string, string> = {}) {
	const mem = memoryStorage(initial);
	const full = { on: true };
	const adapter = {
		...mem,
		set(key: string, value: string) {
			if (full.on) throw new DOMException('full', 'QuotaExceededError');
			mem.set(key, value);
		}
	};
	const storage = createStorage({ adapter, onError: vi.fn() });
	return { mem, full, storage };
}

/** A memory adapter that holds at most `limit` characters of keys and values, like a quota. */
function quota(initial: Record<string, string>, limit: number) {
	const mem = memoryStorage(initial);
	const size = () => [...mem.data].reduce((n, [k, v]) => n + k.length + v.length, 0);
	const adapter: StorageAdapter = {
		...mem,
		set(key, value) {
			const old = mem.data.get(key);
			const grow = key.length + value.length - (old === undefined ? 0 : key.length + old.length);
			if (size() + grow > limit) throw new DOMException('full', 'QuotaExceededError');
			mem.set(key, value);
		}
	};
	return { mem, adapter, storage: createStorage({ adapter, onError: vi.fn() }) };
}

describe('entries', () => {
	it('namespaces keys, allows pinned keys, and refuses duplicates and bad keys', () => {
		const { storage } = setup();
		const timers = storage.scope('timers');
		expect(timers.entry('presets', { label: 'Presets', parse: isNumber }).key).toBe(
			'app:timers:presets'
		);
		expect(
			timers.entry('history', { label: 'History', parse: isNumber, key: 'app:workout-history' }).key
		).toBe('app:workout-history');
		expect(() => timers.entry('presets', { label: 'Again', parse: isNumber })).toThrowError(
			expect.objectContaining({ code: codes.STORAGE_DUPLICATE_KEY })
		);
		for (const key of ['other:x', 'app:', 'app:version', 'app:version:timers', 'app:probe'])
			expect(() => timers.entry('x', { label: 'x', parse: isNumber, key }), key).toThrowError(
				expect.objectContaining({ code: codes.STORAGE_KEY })
			);
		expect(() => storage.scope('Bad Name')).toThrowError(
			expect.objectContaining({ code: codes.STORAGE_KEY })
		);
		expect(() => storage.scope('version')).toThrow();
	});

	it('reads valid values and treats missing, corrupt or invalid ones as undefined', () => {
		const { storage } = setup({
			'app:n:ok': '5',
			'app:n:bad': '"five"',
			'app:n:corrupt': '{nope'
		});
		const n = storage.scope('n');
		const entry = (name: string) => n.entry(name, { label: name, parse: isNumber });
		expect(storage.read(entry('ok'))).toBe(5);
		expect(storage.read(entry('bad'))).toBeUndefined();
		expect(storage.read(entry('corrupt'))).toBeUndefined();
		expect(storage.read(entry('missing'))).toBeUndefined();
	});

	it('never throws when storage is blocked', () => {
		const storage = createStorage({ adapter: blocked, onError: vi.fn() });
		const e = storage.scope('n').entry('x', { label: 'x', parse: isNumber });
		expect(storage.read(e)).toBeUndefined();
		expect(storage.write(e, 1)).toBe(false);
		expect(storage.remove(e)).toBe(false);
		expect(storage.writable()).toBe(false);
		expect(storage.unclaimed()).toEqual([]);
		expect(storage.update(e, 3, (v) => (v ?? 0) + 1)).toEqual({ value: 4, saved: false });
	});

	it('updates from the latest saved value, unless this tab holds unsaved changes', () => {
		const { storage, adapter } = setup({ 'app:n:count': '10' });
		const e = storage.scope('n').entry('count', { label: 'c', parse: isNumber });
		expect(storage.update(e, 1, (v) => (v ?? 0) + 1)).toEqual({ value: 11, saved: true });
		expect(storage.update(e, 1, (v) => (v ?? 0) + 1, { unsaved: true }).value).toBe(2);
		expect(storage.update(e, 1, () => undefined)).toEqual({ value: undefined, saved: true });
		expect(adapter.data.has('app:n:count')).toBe(false);
	});

	it('updates from the saved value even when storage is full', () => {
		const adapter = memoryStorage({ 'app:n:count': '10' });
		const full = {
			...adapter,
			set: () => {
				throw new Error('QuotaExceededError');
			}
		};
		const storage = createStorage({ adapter: full, onError: vi.fn() });
		const e = storage.scope('n').entry('count', { label: 'c', parse: isNumber });
		expect(storage.update(e, 1, (v) => (v ?? 0) + 1)).toEqual({ value: 11, saved: false });
	});

	it('marks a group sensitive when any of its entries is (#76)', () => {
		const { storage } = setup();
		const s = storage.scope('s');
		s.entry('log', { label: 'Log', parse: isNumber, sensitive: true });
		s.entry('prefs', { label: 'Prefs', parse: isNumber });
		const plain = storage.scope('p').entry('x', { label: 'X', parse: isNumber });
		expect(plain.sensitive).toBe(false);
		expect(storage.groups().map((g) => [g.id, g.sensitive])).toEqual([
			['s', true],
			['p', false]
		]);
		for (const flag of ['sensitive', 'backup'])
			expect(() =>
				storage.scope('q').entry(`bad-${flag}`, { label: 'B', parse: isNumber, [flag]: 'yes' })
			).toThrowError(new RegExp(`\\\`${flag}\\\` that isn't true or false`));
	});

	it('clears all entries or a list, groups them, and tells this tab’s listeners', () => {
		const { storage, adapter } = setup({ 'app:a:x': '1', 'app:b:y': '2', 'app:z:other': '3' });
		const a = storage.scope('a').entry('x', { label: 'X', parse: isNumber });
		const b = storage.scope('b').entry('y', { label: 'Y', parse: isNumber, group: 'history' });
		storage.scope('c').entry('w', { label: 'W', parse: isNumber, group: 'history' });
		expect(storage.groups().map((g) => [g.id, g.label, g.entries.length])).toEqual([
			['a', 'X', 1],
			['history', 'Y, W', 2]
		]);
		const seen: unknown[] = [];
		storage.onChange((key, value) => void seen.push([key, value]));
		storage.clear([a]);
		expect([...adapter.data.keys()]).toEqual(['app:b:y', 'app:z:other']);
		storage.clear();
		expect([...adapter.data.keys()]).toEqual(['app:z:other']);
		expect(storage.read(b)).toBeUndefined();
		storage.importData(storage.exportData(), 'merge');
		expect(seen).toEqual([
			['app:a:x', undefined],
			[null, undefined],
			[null, undefined]
		]);
	});
});

describe('migrations', () => {
	it('run once per namespace, in order, and record the version', () => {
		const { storage, adapter } = setup({ 'app:t:presets': '[1,2]', 'app:other:x': '1' });
		const t = storage.scope('t');
		const runs: number[] = [];
		t.migration({
			to: 2,
			run(data) {
				runs.push(2);
				data['app:t:presets'] = { minutes: data['app:t:presets'] };
			}
		});
		t.migration({ to: 1, run: () => void runs.push(1) });
		const e = t.entry('presets', { label: 'p', parse: (v) => v as { minutes: number[] } });
		expect(storage.read(e)).toEqual({ minutes: [1, 2] });
		expect(storage.read(e)).toEqual({ minutes: [1, 2] });
		expect(runs).toEqual([1, 2]);
		expect(adapter.data.get('app:version:t')).toBe('2');
		expect(adapter.data.get('app:other:x')).toBe('1');
	});

	it('uses `app:version` for the app’s own namespace (what xcwds.github.io already has)', () => {
		const { storage, adapter } = setup({ 'app:version': '2', 'app:settings': '{"a":1}' });
		const root = storage.scope('');
		const run = vi.fn((data: Record<string, unknown>) => {
			data['app:settings'] = { ...(data['app:settings'] as object), b: 2 };
		});
		root.migration({ to: 2, run: () => run({}) });
		root.migration({ to: 3, run });
		const e = root.entry('settings', { label: 's', parse: (v) => v });
		expect(storage.read(e)).toEqual({ a: 1, b: 2 });
		expect(run).toHaveBeenCalledTimes(1);
		expect(adapter.data.get('app:version')).toBe('3');
	});

	it('moves legacy keys listed in `keys`, and removes keys deleted from the data', () => {
		const { storage, adapter } = setup({ 'coffee-timer-duration': '120' });
		const coffee = storage.scope('coffee');
		coffee.migration({
			to: 1,
			keys: ['coffee-timer-duration'],
			run(data) {
				data['app:coffee:duration'] = data['coffee-timer-duration'];
				delete data['coffee-timer-duration'];
			}
		});
		const e = coffee.entry('duration', { label: 'd', parse: isNumber });
		expect(storage.read(e)).toBe(120);
		expect(adapter.data.has('coffee-timer-duration')).toBe(false);
	});

	it('leaves data from a newer version alone', () => {
		const { storage, adapter } = setup({ 'app:version:t': '9', 'app:t:x': '"future"' });
		const t = storage.scope('t');
		const run = vi.fn();
		t.migration({ to: 2, run });
		storage.read(t.entry('x', { label: 'x', parse: (v) => v }));
		expect(run).not.toHaveBeenCalled();
		expect(adapter.data.get('app:version:t')).toBe('9');
	});

	it('reports a failing migration, keeps the data, and retries on the next load', () => {
		const initial = { 'app:t:x': '1' };
		const first = setup(initial);
		const t = first.storage.scope('t');
		t.migration({
			to: 1,
			run(data) {
				data['app:t:x'] = 2;
				throw new Error('bug');
			}
		});
		const e = t.entry('x', { label: 'x', parse: isNumber });
		expect(first.storage.read(e)).toBe(1);
		expect(first.onError).toHaveBeenCalledWith(
			expect.objectContaining({ code: codes.STORAGE_MIGRATION })
		);
		expect(first.adapter.data.has('app:version:t')).toBe(false);
	});

	it('rejects bad or duplicate migration versions', () => {
		const t = setup().storage.scope('t');
		expect(() => t.migration({ to: 0, run: () => {} })).toThrow();
		t.migration({ to: 1, run: () => {} });
		expect(() => t.migration({ to: 1, run: () => {} })).toThrowError(
			expect.objectContaining({ code: codes.STORAGE_MIGRATION })
		);
	});
});

describe('a migration storage can’t save (#52)', () => {
	function listSetup(initial: Record<string, string> = { 'app:t:list': '["a","b"]' }) {
		const s = fullable(initial);
		const t = s.storage.scope('t');
		t.migration({
			to: 1,
			run(d) {
				d['app:t:list'] = { items: d['app:t:list'] };
			}
		});
		const e = t.entry('list', {
			label: 'L',
			parse: (v) => (v && !Array.isArray(v) ? (v as { items: string[] }) : undefined)
		});
		return { ...s, e };
	}

	it('still serves the migrated data, and backs it up', () => {
		const { storage, e, mem } = listSetup();
		expect(storage.read(e)).toEqual({ items: ['a', 'b'] });
		expect(storage.exportData().data).toEqual({ 'app:t:list': { items: ['a', 'b'] } });
		// Storage still holds the old data under the old version.
		expect(mem.data.get('app:t:list')).toBe('["a","b"]');
		expect(mem.data.has('app:version:t')).toBe(false);
	});

	it('saves the migrated data with its version on the next write that fits', () => {
		const { storage, e, mem, full } = listSetup();
		storage.read(e);
		expect(storage.write(e, { items: ['c'] })).toBe(false);
		// The change isn't lost while storage is full, and nothing reached storage without the version.
		expect(storage.read(e)).toEqual({ items: ['c'] });
		expect(mem.data.get('app:t:list')).toBe('["a","b"]');
		full.on = false;
		expect(storage.write(e, { items: ['d'] })).toBe(true);
		expect(mem.data.get('app:t:list')).toBe('{"items":["d"]}');
		expect(mem.data.get('app:version:t')).toBe('1');
		expect(storage.read(e)).toEqual({ items: ['d'] });
	});

	it('removes an entry the same way', () => {
		const { storage, e, mem, full } = listSetup();
		storage.read(e);
		full.on = false;
		expect(storage.remove(e)).toBe(true);
		expect(mem.data.has('app:t:list')).toBe(false);
		expect(mem.data.get('app:version:t')).toBe('1');
	});

	it('puts storage back when only part of the migrated data fits', () => {
		const initial = { 'app:t:a': '1', 'app:t:b': '2' };
		const used = Object.entries(initial).reduce((n, [k, v]) => n + k.length + v.length, 0);
		// Room for `a` to grow, but not `b` as well.
		const { storage, mem } = quota(initial, used + 4);
		const t = storage.scope('t');
		t.migration({
			to: 1,
			run(d) {
				d['app:t:a'] = 10000;
				d['app:t:b'] = 20000;
			}
		});
		const a = t.entry('a', { label: 'a', parse: isNumber });
		expect(storage.read(a)).toBe(10000);
		expect(mem.data.get('app:t:a')).toBe('1');
		expect(mem.data.get('app:t:b')).toBe('2');
		expect(mem.data.has('app:version:t')).toBe(false);
	});

	it('doesn’t list a key the migration moves away from as unclaimed', () => {
		// No room for the version key, so the migration can't be saved.
		const { storage, mem } = quota({ 'app:t:old': '5' }, 'app:t:old5'.length + 4);
		const t = storage.scope('t');
		t.migration({
			to: 1,
			run(d) {
				d['app:t:new'] = d['app:t:old'];
				delete d['app:t:old'];
			}
		});
		const e = t.entry('new', { label: 'n', parse: isNumber });
		expect(storage.read(e)).toBe(5);
		expect(mem.data.get('app:t:old')).toBe('5');
		expect(storage.unclaimed()).toEqual([]);
		storage.removeUnclaimed(['app:t:old']);
		expect(mem.data.get('app:t:old')).toBe('5');
		expect(storage.exportData().unclaimed).toEqual({});
	});

	it('returns false for a value it can’t save', () => {
		const { storage, e } = listSetup();
		storage.read(e);
		const cycle: { items: string[]; self?: unknown } = { items: [] };
		cycle.self = cycle;
		expect(storage.write(e, cycle)).toBe(false);
		expect(storage.read(e)).toEqual({ items: ['a', 'b'] });
	});

	it('defers to a migration another tab saved meanwhile', () => {
		const { storage, e, mem } = listSetup();
		storage.read(e);
		mem.set('app:t:list', '{"items":["other tab"]}');
		mem.set('app:version:t', '1');
		expect(storage.read(e)).toEqual({ items: ['other tab'] });
	});
});

describe('replace import when storage fills up (#52)', () => {
	it('puts the previous data back', () => {
		const initial = { 'app:n:a': '1', 'app:n:b': '2', 'app:x:old': '"u"' };
		const used = Object.entries(initial).reduce((n, [k, v]) => n + k.length + v.length, 0);
		// Room for the old data plus a little: the backup's bigger values don't all fit.
		const { storage, mem } = quota(initial, used + 8);
		const n = storage.scope('n');
		const a = n.entry('a', { label: 'a', parse: isNumber });
		const b = n.entry('b', { label: 'b', parse: isNumber });
		const backup = storage.exportData();
		backup.data = { 'app:n:a': 100000, 'app:n:b': 200000 };
		backup.unclaimed = { 'app:y:new': 'v' };
		expect(storage.importData(backup, 'replace')).toBe(false);
		expect(storage.read(a)).toBe(1);
		expect(storage.read(b)).toBe(2);
		expect(mem.data.get('app:x:old')).toBe('"u"');
		expect(mem.data.has('app:y:new')).toBe(false);
	});

	it('replaces everything when it fits', () => {
		const { storage } = quota({ 'app:n:a': '1' }, 1000);
		const a = storage.scope('n').entry('a', { label: 'a', parse: isNumber });
		const backup = storage.exportData();
		backup.data = { 'app:n:a': 5 };
		expect(storage.importData(backup, 'replace')).toBe(true);
		expect(storage.read(a)).toBe(5);
	});
});

describe('save failures', () => {
	it('reports a failing entry once, unless the save was explicit', () => {
		const { storage } = setup();
		const e = storage.scope('n').entry('x', { label: 'x', parse: isNumber });
		const listener = vi.fn();
		storage.onSaveFailure(listener);
		storage.saveResult(e, false);
		storage.saveResult(e, false);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(storage.hasUnsavedChanges(e)).toBe(true);
		storage.saveResult(e, false, { explicit: true });
		expect(listener).toHaveBeenCalledTimes(2);
		expect(storage.saveResult(e, true)).toBe(true);
		expect(storage.hasUnsavedChanges(e)).toBe(false);
		storage.saveResult(e, false);
		expect(listener).toHaveBeenCalledTimes(3);
	});
});

describe('sync between tabs', () => {
	it('passes other tabs’ changes to listeners, with the parsed value', () => {
		const { storage, adapter } = setup();
		const e = storage.scope('n').entry('x', { label: 'x', parse: isNumber });
		const target = new EventTarget();
		const seen: unknown[] = [];
		storage.onChange((key, value) => void seen.push([key, value]));
		storage.startSync(target);
		const fire = (key: string | null) => {
			const event = new Event('storage') as Event & { key: string | null };
			Object.defineProperty(event, 'key', { value: key });
			target.dispatchEvent(event);
		};
		adapter.set(e.key, '7');
		fire(e.key);
		fire('unrelated');
		fire('app:version:n');
		fire('app:probe');
		fire(null);
		storage.stopSync();
		fire(e.key);
		expect(seen).toEqual([
			['app:n:x', 7],
			[null, undefined]
		]);
	});
});

describe('backups', () => {
	function app(initial: Record<string, string> = {}) {
		const s = setup(initial, { appName: 'test-app' });
		const timers = s.storage.scope('timers');
		timers.migration({
			to: 2,
			run(data) {
				const v = data['app:timers:presets'];
				if (Array.isArray(v)) data['app:timers:presets'] = { minutes: v };
			}
		});
		const presets = timers.entry('presets', {
			label: 'Presets',
			parse: (v) =>
				typeof v === 'object' && v !== null && Array.isArray((v as { minutes?: unknown }).minutes)
					? (v as { minutes: number[] })
					: undefined
		});
		const root = s.storage.scope('');
		root.migration({ to: 3, run: () => {} });
		const settings = root.entry('settings', { label: 'Settings', parse: (v) => v as object });
		return { ...s, presets, settings };
	}

	it('round-trips registered data, with versions and unclaimed data', () => {
		const a = app({
			'app:timers:presets': '{"minutes":[1]}',
			'app:settings': '{"theme":"dark"}',
			'app:removed-plugin:thing': '{"keep":true}'
		});
		const backup = a.storage.exportData(new Date('2026-10-09T00:00:00Z'));
		expect(backup).toEqual({
			app: 'test-app',
			format: 2,
			exportedAt: '2026-10-09T00:00:00.000Z',
			versions: { timers: 2, '': 3 },
			data: { 'app:timers:presets': { minutes: [1] }, 'app:settings': { theme: 'dark' } },
			unclaimed: { 'app:removed-plugin:thing': { keep: true } },
			unclaimedVersions: {}
		});

		const b = app();
		const parsed = b.storage.parseBackup(JSON.stringify(backup));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.found.map((e) => e.key)).toEqual(['app:timers:presets', 'app:settings']);
		expect(b.storage.importData(parsed.backup, 'merge')).toBe(true);
		expect(b.storage.read(b.presets)).toEqual({ minutes: [1] });
		expect(b.adapter.data.get('app:removed-plugin:thing')).toBe('{"keep":true}');
	});

	it('upgrades older backups per namespace, including the pre-namespace format', () => {
		const b = app();
		const legacy = {
			app: 'test-app',
			schemaVersion: 3,
			exportedAt: 'then',
			data: { 'app:timers:presets': [5, 10], 'app:settings': { theme: 'light' }, 'app:nope': 1 }
		};
		const parsed = b.storage.parseBackup(JSON.stringify(legacy));
		expect(parsed.ok && parsed.backup.data).toEqual({
			'app:timers:presets': { minutes: [5, 10] },
			'app:settings': { theme: 'light' }
		});
		expect(parsed.ok && parsed.backup.unclaimed).toEqual({ 'app:nope': 1 });
	});

	it('skips invalid values and keys outside the app', () => {
		const b = app();
		const parsed = b.storage.parseBackup(
			JSON.stringify({
				app: 'test-app',
				format: 2,
				versions: { timers: 2 },
				data: { 'app:timers:presets': 'bad', 'app:timers:gone': 1, 'other:key': 1 }
			})
		);
		expect(parsed.ok && parsed.skipped.sort()).toEqual([
			'app:timers:gone',
			'app:timers:presets',
			'other:key'
		]);
	});

	it('refuses files that aren’t backups of this app, or are from a newer version', () => {
		const b = app();
		const parse = (v: unknown) =>
			b.storage.parseBackup(typeof v === 'string' ? v : JSON.stringify(v));
		expect(parse('{nope')).toEqual({ ok: false, error: expect.stringContaining('not valid JSON') });
		expect(parse({ app: 'other', format: 2, versions: {}, data: {} }).ok).toBe(false);
		expect(parse({ app: 'test-app', format: 2, data: {} }).ok).toBe(false);
		expect(parse({ app: 'test-app', format: 2, versions: { timers: 1.5 }, data: {} }).ok).toBe(
			false
		);
		expect(parse({ app: 'test-app', format: 2, versions: { timers: 3 }, data: {} })).toEqual({
			ok: false,
			error: expect.stringContaining('newer version')
		});
	});

	it('replace clears registered entries first; merge keeps what the backup lacks', () => {
		const b = app({ 'app:timers:presets': '{"minutes":[9]}', 'app:settings': '{"x":1}' });
		const backup = {
			app: 'test-app',
			format: 2 as const,
			exportedAt: '',
			versions: {},
			data: { 'app:settings': { y: 2 } },
			unclaimed: {}
		};
		b.storage.importData(backup, 'merge');
		expect(b.storage.read(b.presets)).toEqual({ minutes: [9] });
		b.storage.importData(backup, 'replace');
		expect(b.storage.read(b.presets)).toBeUndefined();
		expect(b.storage.read(b.settings)).toEqual({ y: 2 });
	});

	it('keeps entries with `backup: false` out of backups, but clears them (#104)', () => {
		const tokenFor = (s: ReturnType<typeof app>) =>
			s.storage.scope('timers').entry('token', {
				label: 'Token',
				parse: (v) => (typeof v === 'string' ? v : undefined),
				backup: false
			});
		const a = app({ 'app:timers:token': '"secret"', 'app:settings': '{"x":1}' });
		const token = tokenFor(a);
		expect(token.backup).toBe(false);
		expect(a.presets.backup).toBe(true);
		const backup = a.storage.exportData();
		expect(backup.data).toEqual({ 'app:settings': { x: 1 } });
		expect(JSON.stringify(backup)).not.toContain('secret');

		// An older or hand-edited backup that carries it: reported as skipped, never imported.
		const b = app({ 'app:timers:token': '"mine"' });
		const mine = tokenFor(b);
		const parsed = b.storage.parseBackup(
			JSON.stringify({ ...backup, data: { ...backup.data, 'app:timers:token': 'theirs' } })
		);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.skipped).toEqual(['app:timers:token']);
		expect(parsed.found.map((e) => e.key)).toEqual(['app:settings']);
		expect(parsed.backup.data).not.toHaveProperty('app:timers:token');
		// Even a backup object built by hand can't write it, and neither mode clears it.
		const forged = { ...parsed.backup, data: { ...parsed.backup.data, 'app:timers:token': 'x' } };
		expect(b.storage.importData(forged, 'merge')).toBe(true);
		expect(b.storage.read(mine)).toBe('mine');
		expect(b.storage.importData(forged, 'replace')).toBe(true);
		expect(b.storage.read(mine)).toBe('mine');
		expect(b.storage.read(b.settings)).toEqual({ x: 1 });

		// Clearing its group, or everything, still removes it.
		b.storage.clear(b.storage.groups().find((g) => g.id === 'timers')!.entries);
		expect(b.storage.read(mine)).toBeUndefined();
		b.storage.write(mine, 'again');
		b.storage.clear();
		expect(b.adapter.data.has('app:timers:token')).toBe(false);
	});

	describe('when a plugin with migrations was removed (#51)', () => {
		/** An app with the `old` plugin at the given migrations (none: removed). */
		function withOld(adapter = memoryStorage(), runs: number[] = [], tos: number[] = []) {
			const storage = createStorage({ adapter, appName: 'x', onError: vi.fn() });
			storage.scope('').entry('settings', { label: 'S', parse: (v) => v });
			let thing;
			if (tos.length) {
				const old = storage.scope('old');
				for (const to of tos)
					old.migration({
						to,
						run(d) {
							runs.push(to);
							d['app:old:thing'] = `${d['app:old:thing']}+${to}`;
						}
					});
				thing = old.entry('thing', { label: 'T', parse: (v) => v });
			}
			return { storage, adapter, thing, runs };
		}

		function oldBackup() {
			const a = withOld(memoryStorage(), [], [1]);
			a.storage.write(a.thing!, 'hello');
			return JSON.stringify(a.storage.exportData());
		}

		it('still imports a backup made before, keeping its data as unclaimed', () => {
			const b = withOld();
			const parsed = b.storage.parseBackup(oldBackup());
			expect(parsed.ok).toBe(true);
			if (!parsed.ok) return;
			expect(parsed.backup.unclaimed).toEqual({ 'app:old:thing': 'hello' });
			expect(parsed.backup.unclaimedVersions).toEqual({ old: 1 });
			expect(b.storage.importData(parsed.backup, 'replace')).toBe(true);
			expect(b.adapter.data.get('app:old:thing')).toBe('"hello"');
			expect(b.adapter.data.get('app:version:old')).toBe('1');
		});

		it('migrates only what the data hasn’t had when the plugin comes back', () => {
			// Removed on this device: the data and its version stay, and backups carry both.
			const b = withOld();
			const parsed = b.storage.parseBackup(oldBackup());
			if (!parsed.ok) throw new Error(parsed.error);
			b.storage.importData(parsed.backup, 'replace');
			const backup = b.storage.exportData();
			expect(backup.unclaimedVersions).toEqual({ old: 1 });

			// Back on the same device.
			const same = withOld(b.adapter, [], [1, 2]);
			expect(same.storage.read(same.thing!)).toBe('hello+2');
			expect(same.runs).toEqual([2]);

			// Back on another device, from the backup made while it was gone.
			const other = withOld(memoryStorage(), [], [1, 2]);
			const again = other.storage.parseBackup(JSON.stringify(backup));
			expect(again.ok && again.backup.data).toEqual({ 'app:old:thing': 'hello+2' });
			expect(other.runs).toEqual([2]);
		});

		it('never leaves imported data under another version', () => {
			const parsed = withOld().storage.parseBackup(oldBackup()); // app:old:thing at v1
			if (!parsed.ok) throw new Error(parsed.error);

			// Leftovers deleted at v2: the version goes too, so merge imports v1 with its version.
			const cleared = withOld(memoryStorage({ 'app:old:x': '1', 'app:version:old': '2' }));
			cleared.storage.removeUnclaimed(['app:old:x']);
			expect(cleared.storage.importData(parsed.backup, 'merge')).toBe(true);
			expect(cleared.adapter.data.get('app:old:thing')).toBe('"hello"');
			expect(cleared.adapter.data.get('app:version:old')).toBe('1');

			// Data still here at v2: merge keeps it, replace takes the backup's whole.
			const initial = { 'app:old:x': '1', 'app:version:old': '2' };
			const merged = withOld(memoryStorage(initial));
			expect(merged.storage.importData(parsed.backup, 'merge')).toBe(true);
			expect(Object.fromEntries(merged.adapter.data)).toEqual(initial);
			const replaced = withOld(memoryStorage(initial));
			expect(replaced.storage.importData(parsed.backup, 'replace')).toBe(true);
			expect(replaced.adapter.data.has('app:old:x')).toBe(false);
			expect(replaced.adapter.data.get('app:old:thing')).toBe('"hello"');
			expect(replaced.adapter.data.get('app:version:old')).toBe('1');
		});

		it('still refuses data newer than a registered plugin knows', () => {
			const b = withOld(memoryStorage(), [], [1]);
			const backup = JSON.parse(oldBackup());
			backup.unclaimedVersions = { old: 5 };
			delete backup.versions.old;
			expect(b.storage.parseBackup(JSON.stringify(backup))).toEqual({
				ok: false,
				error: expect.stringContaining('newer version')
			});
		});
	});

	it('lists and deletes only unclaimed keys', () => {
		const b = app({
			'app:timers:presets': '{"minutes":[1]}',
			'app:timers:stale': '1',
			'app:gone:x': '1',
			'app:version:gone': '4',
			'not-ours': '1'
		});
		expect(b.storage.unclaimed()).toEqual([{ key: 'app:gone:x', namespace: 'gone' }]);
		b.storage.removeUnclaimed(['app:gone:x', 'app:timers:presets', 'not-ours']);
		// The removed plugin's version goes with the last of its data.
		expect([...b.adapter.data.keys()].sort()).toEqual([
			'app:timers:presets',
			'app:timers:stale',
			'not-ours'
		]);
	});
});

describe('persistence', () => {
	it('reports unsupported where navigator.storage is missing', async () => {
		const { storage } = setup();
		vi.stubGlobal('navigator', {});
		expect(await storage.requestPersistence()).toBe('unsupported');
		expect(await storage.persisted()).toBe('unsupported');
		vi.stubGlobal('navigator', {
			storage: { persist: async () => true, persisted: async () => true }
		});
		expect(await storage.requestPersistence()).toBe('granted');
		expect(await storage.persisted()).toBe(true);
		vi.unstubAllGlobals();
	});
});

describe('storage layers (#79)', () => {
	const SECRET = 'app:diary:';
	const BLOB = 'app:sealed';
	/** Like a vault: keys under `app:diary:` live in memory while unlocked, kept below as one blob. */
	function sealing() {
		const state = { locked: false, memory: new Map<string, string>() };
		const scramble = (text: string) => btoa([...text].reverse().join(''));
		const unscramble = (text: string) => [...atob(text)].reverse().join('');
		let inner: StorageAdapter;
		const save = () => inner.set(BLOB, scramble(JSON.stringify(Object.fromEntries(state.memory))));
		const check = () => {
			if (state.locked) throw new XcwdsError(codes.LOCKED, 'Locked.');
		};
		const layer: StorageLayer = (below) => {
			inner = below;
			const blob = below.get(BLOB);
			if (blob) state.memory = new Map(Object.entries(JSON.parse(unscramble(blob))));
			return {
				get: (key) =>
					key.startsWith(SECRET) ? (check(), state.memory.get(key) ?? null) : below.get(key),
				set: (key, value) =>
					key.startsWith(SECRET)
						? (check(), state.memory.set(key, value), save())
						: below.set(key, value),
				remove: (key) =>
					key.startsWith(SECRET) ? (check(), state.memory.delete(key), save()) : below.remove(key),
				keys: () => [
					...below.keys().filter((key) => key !== BLOB),
					...(state.locked ? [] : state.memory.keys())
				]
			};
		};
		return { state, layer };
	}

	function diary(initial: Record<string, string> = {}) {
		const s = setup(initial);
		const vault = sealing();
		const d = s.storage.scope('diary');
		const note = d.entry('note', {
			label: 'Note',
			parse: (v) => (typeof v === 'string' ? v : undefined),
			sensitive: true
		});
		const other = s.storage.scope('other').entry('n', { label: 'N', parse: isNumber });
		return { ...s, vault, note, other };
	}

	it('keeps what a layer claims out of the adapter below, and passes the rest through', () => {
		const { storage, adapter, vault, note, other } = diary();
		storage.layer(vault.layer);
		expect(storage.write(note, 'cycle day 12')).toBe(true);
		expect(storage.write(other, 3)).toBe(true);
		expect(storage.read(note)).toBe('cycle day 12');
		expect(adapter.data.get('app:other:n')).toBe('3');
		expect(adapter.data.has('app:diary:note')).toBe(false);
		expect([...adapter.data.values()].join()).not.toContain('cycle');
		expect(storage.unclaimed()).toEqual([]);
	});

	it('reads nothing and saves nothing while locked, then serves the data again after reload()', () => {
		const { storage, vault, note, other } = diary();
		storage.layer(vault.layer);
		storage.write(note, 'cycle day 12');
		vault.state.locked = true;
		storage.reload();
		expect(storage.read(note)).toBeUndefined();
		expect(storage.write(note, 'changed')).toBe(false);
		expect(storage.remove(note)).toBe(false);
		expect(storage.update(note, undefined, () => 'again').saved).toBe(false);
		expect(storage.read(other)).toBeUndefined();
		expect(storage.write(other, 1)).toBe(true);
		vault.state.locked = false;
		storage.reload();
		expect(storage.read(note)).toBe('cycle day 12');
	});

	it('runs a migration that waited while locked once reloaded', () => {
		const { storage, adapter, vault, note } = diary();
		storage.layer(vault.layer);
		storage.write(note, 'old');
		vault.state.locked = true;
		storage.reload();
		storage.scope('diary').migration({
			to: 1,
			run(data) {
				data['app:diary:note'] = `${data['app:diary:note'] as string} (migrated)`;
			}
		});
		expect(storage.read(note)).toBeUndefined();
		expect(adapter.data.has('app:version:diary')).toBe(false);
		vault.state.locked = false;
		storage.reload();
		expect(storage.read(note)).toBe('old (migrated)');
		expect(adapter.data.get('app:version:diary')).toBe('1');
		expect(storage.read(note)).toBe('old (migrated)');
	});

	it('tells change listeners when it reloads, and when a layer is added', () => {
		const { storage, vault } = diary();
		const seen: unknown[] = [];
		storage.onChange((key, value) => seen.push([key, value]));
		storage.layer(vault.layer);
		storage.reload();
		expect(seen).toEqual([
			[null, undefined],
			[null, undefined]
		]);
	});

	it('keeps a migrated copy storage could not save yet', () => {
		const { storage, full, mem } = fullable({ 'app:t:list': '["a"]' });
		const t = storage.scope('t');
		t.migration({
			to: 1,
			run(d) {
				d['app:t:list'] = { items: d['app:t:list'] };
			}
		});
		const e = t.entry('list', { label: 'L', parse: (v) => v as { items: string[] } });
		expect(storage.read(e)).toEqual({ items: ['a'] });
		storage.reload();
		expect(storage.read(e)).toEqual({ items: ['a'] });
		full.on = false;
		expect(storage.write(e, { items: ['b'] })).toBe(true);
		expect(mem.data.get('app:version:t')).toBe('1');
	});

	it('stacks layers, the last one on top', () => {
		const { storage, adapter } = setup();
		const calls: string[] = [];
		const tag =
			(name: string): StorageLayer =>
			(inner) => ({
				...inner,
				set: (key, value) => {
					calls.push(name);
					inner.set(key, value);
				}
			});
		storage.layer(tag('first'));
		storage.layer(tag('second'));
		const e = storage.scope('x').entry('v', { label: 'V', parse: isNumber });
		storage.write(e, 1);
		expect(calls).toEqual(['second', 'first']);
		expect(adapter.data.get('app:x:v')).toBe('1');
	});

	it('refuses a layer that is not a function or returns no adapter', () => {
		const { storage } = setup();
		expect(() => storage.layer('nope' as unknown as StorageLayer)).toThrow(
			expect.objectContaining({ code: codes.STORAGE_KEY })
		);
		expect(() => storage.layer(() => ({}) as StorageAdapter)).toThrow(/`get`/);
	});

	it('exports the version a waiting migration leaves the data at', async () => {
		const { storage, vault, other } = diary();
		storage.layer(vault.layer);
		storage.write(other, 1);
		vault.state.locked = true;
		storage.reload();
		storage.scope('diary').migration({ to: 1, run: () => {} });
		storage.scope('other').migration({ to: 2, run: () => {} });
		// diary's migration waits for the unlock, so its data is still at version 0.
		expect(storage.exportData().versions).toEqual({ diary: 0, other: 2 });
		vault.state.locked = false;
		storage.reload();
		expect((await storage.exportBackup()).versions).toEqual({ diary: 1, other: 2 });
	});
});

describe('backup sections (#79)', () => {
	const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
	function sectioned() {
		const s = setup({ 'app:diary:note': '"cycle day 12"', 'app:other:n': '3' });
		const note = s.storage.scope('diary').entry('note', { label: 'Note', parse: text });
		const other = s.storage.scope('other').entry('n', { label: 'N', parse: isNumber });
		const section = {
			on: true,
			covers: (key: string) => section.on && key.startsWith('app:diary:'),
			export: vi.fn(async (): Promise<unknown> => (section.on ? { sealed: 'xyz' } : undefined))
		};
		s.storage.backupSection('vault', section);
		return { ...s, note, other, section };
	}

	it('leaves what a section covers out of data, and adds the section as format 3', async () => {
		const { storage, section } = sectioned();
		const backup = await storage.exportBackup(new Date('2026-10-24T00:00:00Z'));
		expect(backup).toMatchObject({
			format: 3,
			exportedAt: '2026-10-24T00:00:00.000Z',
			data: { 'app:other:n': 3 },
			sections: { vault: { sealed: 'xyz' } }
		});
		expect(backup.data).not.toHaveProperty('app:diary:note');
		expect(section.export).toHaveBeenCalledOnce();
		// exportData alone never includes sections.
		expect(storage.exportData()).not.toHaveProperty('sections');
	});

	it('is format 2 when no section adds anything', async () => {
		const { storage, section } = sectioned();
		section.on = false;
		const backup = await storage.exportBackup(new Date(0));
		expect(backup).toEqual(storage.exportData(new Date(0)));
		expect(backup.format).toBe(2);
		expect(backup.data).toEqual({ 'app:diary:note': 'cycle day 12', 'app:other:n': 3 });
	});

	it('parses format 3 keeping its sections unread, and imports only data', async () => {
		const a = sectioned();
		const b = sectioned();
		const parsed = b.storage.parseBackup(JSON.stringify(await a.storage.exportBackup()));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.backup.format).toBe(3);
		expect(parsed.backup.sections).toEqual({ vault: { sealed: 'xyz' } });
		expect(parsed.found.map((e) => e.key)).toEqual(['app:other:n']);
		b.storage.clear();
		expect(b.storage.importData(parsed.backup, 'merge')).toBe(true);
		expect(b.storage.read(b.other)).toBe(3);
		expect(b.storage.read(b.note)).toBeUndefined();
		expect(b.adapter.data.has('app:sections')).toBe(false);
	});

	it('runs migrations before a section exports', async () => {
		const { storage, adapter, section } = sectioned();
		storage.scope('diary').migration({
			to: 1,
			run(data) {
				data['app:diary:note'] = 'migrated';
			}
		});
		section.export.mockImplementation(async () => adapter.data.get('app:diary:note'));
		const backup = await storage.exportBackup();
		expect(backup.sections).toEqual({ vault: '"migrated"' });
		expect(backup.versions.diary).toBe(1);
	});

	it('refuses an unknown format, a duplicate id and a section without its functions', () => {
		const { storage, section } = sectioned();
		const parse = (format: unknown) =>
			storage.parseBackup(JSON.stringify({ app: 'xcwds', format, versions: {}, data: {} }));
		expect(parse(4)).toEqual({ ok: false, error: 'This backup has an unknown format.' });
		expect(parse(3).ok).toBe(true);
		expect(() => storage.backupSection('vault', section)).toThrow(
			expect.objectContaining({ code: codes.STORAGE_KEY })
		);
		expect(() => storage.backupSection('bad id', section)).toThrow(/backup section id/);
		expect(() =>
			storage.backupSection('other', { covers: () => false } as unknown as typeof section)
		).toThrow(/`covers` and `export`/);
	});
});

describe('prefixed entries (#157)', () => {
	const prefixedSetup = (initial: Record<string, string> = {}) => {
		const s = setup(initial);
		const data = s.storage
			.scope('blocks')
			.entry('data', { label: 'Your apps', parse: isNumber, prefix: true });
		return { ...s, data };
	};

	it('reads, writes, removes and lists ids under the prefix', () => {
		const { storage, adapter, data } = prefixedSetup();
		expect(data.key).toBe('app:blocks:data:');
		expect(data.prefix).toBe(true);
		expect(storage.keys(data)).toEqual([]);
		expect(storage.write(data.at('b'), 2)).toBe(true);
		expect(storage.write(data.at('a'), 1)).toBe(true);
		expect(adapter.data.get('app:blocks:data:a')).toBe('1');
		expect(storage.read(data.at('a'))).toBe(1);
		expect(storage.keys(data)).toEqual(['a', 'b']);
		expect(storage.remove(data.at('a'))).toBe(true);
		expect(storage.keys(data)).toEqual(['b']);
		const { value, saved } = storage.update(data.at('b'), undefined, (n) => (n ?? 0) + 1);
		expect([value, saved]).toEqual([3, true]);
	});

	it('drops invalid values on read, and the entry itself holds no value', () => {
		const { storage, data } = prefixedSetup({ 'app:blocks:data:x': '"nope"' });
		expect(storage.read(data.at('x'))).toBeUndefined();
		expect(storage.read(data)).toBeUndefined();
		expect(() => storage.write(data, 1)).toThrow(XcwdsError);
		expect(() => storage.remove(data)).toThrow(XcwdsError);
		expect(() => data.at('')).toThrow(XcwdsError);
		expect(() => data.at('has space')).toThrow(XcwdsError);
		const exact = storage.scope('n').entry('x', { label: 'x', parse: isNumber });
		expect(() => storage.keys(exact as never)).toThrow(XcwdsError);
	});

	it('claims its keys, so they are not unclaimed', () => {
		const { storage } = prefixedSetup({ 'app:blocks:data:a': '1', 'app:blocks:other': '2' });
		expect(storage.unclaimed()).toEqual([]);
		const { storage: bare } = setup({ 'app:blocks:data:a': '1' });
		expect(bare.unclaimed()).toEqual([{ key: 'app:blocks:data:a', namespace: 'blocks' }]);
	});

	it('claims keys under the app’s own root namespace too', () => {
		const { storage } = setup({ 'app:notes:a': '1' });
		const notes = storage
			.scope('')
			.entry('notes', { label: 'Notes', parse: isNumber, prefix: true });
		expect(notes.key).toBe('app:notes:');
		expect(storage.unclaimed()).toEqual([]);
		expect(storage.keys(notes)).toEqual(['a']);
	});

	it('round-trips through a backup, listed once', () => {
		const { storage, data } = prefixedSetup();
		storage.write(data.at('a'), 1);
		storage.write(data.at('b'), 2);
		const backup = storage.exportData();
		expect(backup.data).toEqual({ 'app:blocks:data:a': 1, 'app:blocks:data:b': 2 });
		expect(backup.unclaimed).toEqual({});

		const other = prefixedSetup();
		other.storage.write(other.data.at('c'), 3);
		const parsed = other.storage.parseBackup(
			JSON.stringify({ ...backup, data: { ...backup.data, 'app:blocks:data:bad': 'x' } })
		);
		if (!parsed.ok) throw new Error(parsed.error);
		expect(parsed.found).toEqual([other.data]);
		expect(parsed.skipped).toEqual(['app:blocks:data:bad']);
		expect(other.storage.importData(parsed.backup, 'merge')).toBe(true);
		expect(other.storage.keys(other.data)).toEqual(['a', 'b', 'c']);
		expect(other.storage.importData(parsed.backup, 'replace')).toBe(true);
		expect(other.storage.keys(other.data)).toEqual(['a', 'b']);
	});

	it('puts every id back when a replace import doesn’t fit', () => {
		const initial = { 'app:blocks:data:a': '1' };
		const { storage, mem } = quota(initial, 40);
		const data = storage
			.scope('blocks')
			.entry('data', { label: 'Your apps', parse: isNumber, prefix: true });
		const backup = storage.exportData();
		backup.data = { 'app:blocks:data:b': 100000, 'app:blocks:data:c': 200000 };
		expect(storage.importData(backup, 'replace')).toBe(false);
		expect(storage.keys(data)).toEqual(['a']);
		expect([...mem.data.keys()]).toEqual(['app:blocks:data:a']);
	});

	it('is one item in its group, and clearing the group removes every id', () => {
		const { storage, data } = prefixedSetup();
		const prefs = storage.scope('blocks').entry('prefs', { label: 'Prefs', parse: isNumber });
		storage.write(data.at('a'), 1);
		storage.write(data.at('b'), 2);
		storage.write(prefs, 3);
		const group = storage.groups().find((g) => g.id === 'blocks')!;
		expect(group.entries).toEqual([data, prefs]);
		expect(group.label).toBe('Your apps, Prefs');
		const heard: unknown[] = [];
		storage.onChange((key) => void heard.push(key));
		storage.clear([data]);
		expect(storage.keys(data)).toEqual([]);
		expect(storage.read(prefs)).toBe(3);
		expect(heard).toEqual(['app:blocks:data:a', 'app:blocks:data:b']);
		storage.write(data.at('c'), 4);
		storage.clear();
		expect(storage.keys(data)).toEqual([]);
	});

	it('makes its group sensitive, so a lock’s reset clears its ids', () => {
		const { storage } = setup();
		const diary = storage
			.scope('diary')
			.entry('day', { label: 'Days', parse: isNumber, prefix: true, sensitive: true });
		storage.write(diary.at('2026-10-14'), 1);
		const sensitive = storage.groups().filter((g) => g.sensitive);
		expect(sensitive.map((g) => g.id)).toEqual(['diary']);
		storage.clear(sensitive.flatMap((g) => g.entries));
		expect(storage.keys(diary)).toEqual([]);
	});

	it('hands migrations every key under the prefix, here and in older backups', () => {
		const initial = { 'app:blocks:data:a': '1', 'app:blocks:data:b': '2' };
		const { storage, data } = prefixedSetup(initial);
		storage.scope('blocks').migration({
			to: 1,
			run(d) {
				for (const key of Object.keys(d))
					if (typeof d[key] === 'number') d[key] = (d[key] as number) * 10;
			}
		});
		expect(storage.keys(data)).toEqual(['a', 'b']);
		expect(storage.read(data.at('a'))).toBe(10);
		expect(storage.read(data.at('b'))).toBe(20);
		const parsed = storage.parseBackup(
			JSON.stringify({
				app: 'xcwds',
				format: 2,
				versions: { blocks: 0 },
				data: { 'app:blocks:data:c': 3 },
				unclaimed: {}
			})
		);
		if (!parsed.ok) throw new Error(parsed.error);
		expect(parsed.backup.data).toEqual({ 'app:blocks:data:c': 30 });
	});

	it('follows other tabs’ changes to one id', () => {
		const { storage, adapter, data } = prefixedSetup();
		const target = new EventTarget();
		const seen: unknown[] = [];
		storage.onChange((key, value) => void seen.push([key, value]));
		storage.startSync(target);
		adapter.set('app:blocks:data:a', '5');
		const event = new Event('storage') as Event & { key: string | null };
		Object.defineProperty(event, 'key', { value: 'app:blocks:data:a' });
		target.dispatchEvent(event);
		expect(seen).toEqual([['app:blocks:data:a', 5]]);
		expect(storage.read(data.at('a'))).toBe(5);
	});

	it('refuses an exact entry and a prefixed one that overlap', () => {
		const { storage } = setup();
		const x = storage.scope('x');
		x.entry('data', { label: 'Data', parse: isNumber });
		// `app:x:data` and `app:x:data:` don't overlap.
		x.entry('data', { label: 'Each', parse: isNumber, prefix: true });
		expect(() => x.entry('data:one', { label: 'One', parse: isNumber })).toThrow(
			expect.objectContaining({ code: codes.STORAGE_DUPLICATE_KEY })
		);
		x.entry('foo', { label: 'Foo', parse: isNumber });
		expect(() =>
			x.entry('all', { label: 'All', parse: isNumber, prefix: true, key: 'app:x:' })
		).toThrow(expect.objectContaining({ code: codes.STORAGE_DUPLICATE_KEY }));
		expect(() =>
			x.entry('sub', { label: 'Sub', parse: isNumber, prefix: true, key: 'app:x:data:sub:' })
		).toThrow(expect.objectContaining({ code: codes.STORAGE_DUPLICATE_KEY }));
		expect(() =>
			x.entry('bad', { label: 'Bad', parse: isNumber, prefix: true, key: 'app:x:bad' })
		).toThrow(expect.objectContaining({ code: codes.STORAGE_KEY }));
		expect(() =>
			x.entry('flag', { label: 'Flag', parse: isNumber, prefix: 'yes' as never })
		).toThrow(expect.objectContaining({ code: codes.STORAGE_KEY }));
	});
});
