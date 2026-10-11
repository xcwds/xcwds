import { describe, expect, it, vi } from 'vitest';
import { codes } from './errors.js';
import { createStorage, memoryStorage, type StorageAdapter } from './storage.js';

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
			unclaimed: { 'app:removed-plugin:thing': { keep: true } }
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
		expect([...b.adapter.data.keys()].sort()).toEqual([
			'app:timers:presets',
			'app:timers:stale',
			'app:version:gone',
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
