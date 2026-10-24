/**
 * Saved data, generalised from xcwds.github.io's `src/lib/storage.ts` (#8). Every value an app
 * saves is a registered entry with a key, a label and a validator. Reads never throw: missing,
 * corrupt, invalid or blocked storage all read as `undefined`. Each plugin has a namespace
 * (`app:<namespace>:<key>`) with its own schema version and migrations.
 *
 * Namespaces keep plugins from clobbering each other by accident. They are not a security
 * boundary: any script on the origin can read all of `localStorage`, so plugins are trusted code.
 */
import { XcwdsError, codes } from './errors.js';
import type { Collection } from './blobs.js';
import { isRecord } from './json.js';

// ---------------------------------------------------------------------------------------------
// Adapters

/**
 * Where values are kept. Methods may throw (storage blocked, quota exceeded); the registry
 * catches. `localStorage` is synchronous and holds about 5 MB per origin; an IndexedDB-backed
 * adapter can replace it later without changing entries.
 */
export type StorageAdapter = {
	get(key: string): string | null;
	set(key: string, value: string): void;
	remove(key: string): void;
	keys(): string[];
};

/**
 * Wraps the adapter beneath it, so a plugin can change how some keys are kept without the
 * registry knowing (#79: `@xcwds/plugin-vault` keeps sensitive groups sealed and serves them from
 * memory while unlocked). It stays synchronous. For a key it can't serve right now (locked), it
 * throws, ideally an `XcwdsError` with `codes.LOCKED`: reads then return `undefined`, writes
 * return false and migrations wait until `reload()`.
 */
export type StorageLayer = (inner: StorageAdapter) => StorageAdapter;

/** `localStorage`, looked up on every call so a blocked or missing one just fails that call. */
export function localStorageAdapter(): StorageAdapter {
	const store = () => {
		const s = globalThis.localStorage;
		if (!s) throw new Error('localStorage is not available');
		return s;
	};
	return {
		get: (key) => store().getItem(key),
		set: (key, value) => store().setItem(key, value),
		remove: (key) => store().removeItem(key),
		keys: () => {
			const s = store();
			const out: string[] = [];
			for (let i = 0; i < s.length; i++) {
				const key = s.key(i);
				if (key !== null) out.push(key);
			}
			return out;
		}
	};
}

/** An in-memory adapter for tests and for environments without storage. */
export function memoryStorage(initial: Record<string, string> = {}): StorageAdapter & {
	data: Map<string, string>;
} {
	const data = new Map(Object.entries(initial));
	return {
		data,
		get: (key) => data.get(key) ?? null,
		set: (key, value) => void data.set(key, value),
		remove: (key) => void data.delete(key),
		keys: () => [...data.keys()]
	};
}

// ---------------------------------------------------------------------------------------------
// Entries and migrations

export type Entry<T> = {
	/** The full storage key, e.g. `app:timers:presets`. */
	readonly key: string;
	/** Human-readable, for Settings and backups. */
	readonly label: string;
	/** Returns the value if `raw` is valid for this entry, otherwise `undefined`. */
	readonly parse: (raw: unknown) => T | undefined;
	/** Lets users clear one area (e.g. workout history) without wiping another. */
	readonly group: string;
	readonly namespace: string;
	/** Whether backups carry it (false for secrets and re-downloadable caches). */
	readonly backup: boolean;
	/** Personal data a lock's reset clears (`@xcwds/plugin-lock`); see `EntryOptions`. */
	readonly sensitive: boolean;
	/**
	 * A prefixed entry (`prefix: true`): `key` ends with `:` and the entry claims every key that
	 * starts with it. It is never read or written itself: use `at(id)`.
	 */
	readonly prefix: boolean;
};

/**
 * An entry for keys made at runtime (#157), such as one per app a person builds: it claims every
 * key under `key` (`app:<namespace>:<name>:<id>`), each checked by the same `parse`. Backups,
 * groups, clearing, a lock's reset and migrations cover all of them.
 */
export type PrefixEntry<T> = Entry<T> & {
	readonly prefix: true;
	/** The exact entry for one id, for `read`, `write`, `remove`, `update` and `persist()`. */
	at(id: string): Entry<T>;
};

export type EntryOptions<T> = {
	label: string;
	parse: (raw: unknown) => T | undefined;
	/** Defaults to the namespace (or the key's name at the root). */
	group?: string;
	/**
	 * An exact key instead of `app:<namespace>:<name>`, so an app moving onto the framework keeps
	 * the keys its users already have (e.g. `app:settings`). It must start with the prefix.
	 */
	key?: string;
	/**
	 * `false` keeps it out of backups: exports leave it out, imports neither write nor clear it
	 * (restoring a backup mustn't sign you out of a service), and "Clear data" still removes it.
	 * For secrets such as access tokens and for large caches that can be downloaded again.
	 */
	backup?: boolean;
	/**
	 * `true` marks it as personal data: its whole group counts as sensitive, and resetting a
	 * forgotten passcode (`@xcwds/plugin-lock`) clears exactly the sensitive groups.
	 */
	sensitive?: boolean;
	/**
	 * `true` claims every key under `app:<namespace>:<name>:` (see `PrefixEntry`); `key`, if
	 * given, must then end with `:`. An exact entry and a prefixed one can't overlap.
	 */
	prefix?: boolean;
};

/**
 * Upgrades a namespace's saved data to schema version `to`. `data` holds the decoded values of
 * the namespace's keys (and `keys`), keyed by full storage key; change it in place. Keys
 * deleted from it are removed. Migrations run on this device's storage and on older backups.
 */
export type Migration = {
	to: number;
	/** Extra full keys to include, e.g. keys from before the namespace existed. */
	keys?: string[];
	run(data: Record<string, unknown>): void;
};

export type Group = {
	id: string;
	label: string;
	entries: Entry<unknown>[];
	/** The group's blob collections (`app.blobs`), which clearing the group clears too. */
	collections: Collection[];
	/** Any of its entries or collections is `sensitive`, so a lock's reset clears the whole group. */
	sensitive: boolean;
};

export type Backup = {
	app: string;
	/** 3 when it has `sections`, otherwise 2. */
	format: 2 | 3;
	exportedAt: string;
	/** Schema version per namespace (`''` is the app's own). */
	versions: Record<string, number>;
	/** Saved values keyed by storage key. */
	data: Record<string, unknown>;
	/** Values no registered plugin claims (a plugin that was removed), kept so they can return. */
	unclaimed: Record<string, unknown>;
	/**
	 * Schema version of each namespace in `unclaimed`, so a plugin that comes back only runs the
	 * migrations its data hasn't had yet. Older backups don't have it.
	 */
	unclaimedVersions?: Record<string, number>;
	/**
	 * Format 3: what backup sections added, by section id (`@xcwds/plugin-vault`'s sealed groups,
	 * say). Their keys are left out of `data`; importing doesn't read them, the section's plugin
	 * does.
	 */
	sections?: Record<string, unknown>;
};

/**
 * Part of a backup a plugin makes itself (#79: `@xcwds/plugin-vault` puts the sensitive groups in
 * one, sealed, instead of in `data`), registered with `storage.backupSection(id, section)`.
 */
export type BackupSection = {
	/** Whether the section carries this storage key, which `data` then leaves out. */
	covers(key: string): boolean;
	/**
	 * The section's JSON-serialisable value for `exportBackup()` (after every namespace's
	 * migrations have run), or undefined to add none.
	 */
	export(): Promise<unknown>;
};

export type ParsedBackup =
	| {
			ok: true;
			backup: Backup;
			/** Entries the backup has valid data for. */
			found: Entry<unknown>[];
			/** Keys that are unknown or failed validation; they won't be imported. */
			skipped: string[];
	  }
	| { ok: false; error: string };

export type UnclaimedKey = { key: string; namespace: string };

export type ChangeListener = (key: string | null, value: unknown) => void;

export type SaveFailureListener = (entry: Entry<unknown>, options: { explicit: boolean }) => void;

/** The storage API every plugin gets as `app.storage`, bound to its namespace. */
export type StorageScope = Omit<StorageRegistry, 'scope'> & {
	readonly namespace: string;
	/** Registers an entry under this namespace (a `PrefixEntry` with `prefix: true`). */
	entry<T>(name: string, options: EntryOptions<T> & { prefix: true }): PrefixEntry<T>;
	entry<T>(name: string, options: EntryOptions<T>): Entry<T>;
	/** Registers a migration for this namespace. Register before reading. */
	migration(migration: Migration): void;
};

export type StorageRegistry = {
	readonly prefix: string;
	scope(namespace: string): StorageScope;
	/** Every registered entry. */
	entries(): Entry<unknown>[];
	groups(): Group[];

	read<T>(entry: Entry<T>): T | undefined;
	/** The ids saved under a prefixed entry, sorted (`[]` when storage can't be read). */
	keys(entry: PrefixEntry<unknown>): string[];
	/** Saves a value; false if it couldn't be stored (unavailable, full). */
	write<T>(entry: Entry<T>, value: T): boolean;
	remove(entry: Entry<unknown>): boolean;
	/** The value `update()` starts from: what's saved, or `current` when storage can't be used. */
	latest<T>(
		entry: Entry<T>,
		current: T | undefined,
		options?: { unsaved?: boolean }
	): T | undefined;
	/**
	 * Applies `change` to the latest saved value and saves it, so one tab never overwrites what
	 * another saved meanwhile. `undefined` removes the entry.
	 */
	update<T>(
		entry: Entry<T>,
		current: T | undefined,
		change: (latest: T | undefined) => T | undefined,
		options?: { unsaved?: boolean }
	): { value: T | undefined; saved: boolean };
	/** Whether this browser lets the app save at all. */
	writable(): boolean;
	/** Removes the given entries (default: every registered entry). */
	clear(list?: Entry<unknown>[]): void;

	/** Records a write's outcome; a failure is reported once per entry unless `explicit`. */
	saveResult(entry: Entry<unknown>, saved: boolean, options?: { explicit?: boolean }): boolean;
	/** Whether the last write of `entry` failed, so this tab holds changes storage doesn't. */
	hasUnsavedChanges(entry: Entry<unknown>): boolean;
	onSaveFailure(listener: SaveFailureListener): () => void;

	/**
	 * Listens for changes other tabs save, and for this tab's `clear()` and `importData()`
	 * (`key` is null when everything was cleared or imported).
	 */
	onChange(listener: ChangeListener): () => void;
	/** Starts listening for `storage` events. Browser only; returns a stop function. */
	startSync(target?: EventTarget): () => void;
	stopSync(): void;

	/**
	 * What a backup holds now, without backup sections (and without the keys they cover). Use
	 * `exportBackup()` for a backup people download.
	 */
	exportData(now?: Date): Backup;
	/** A backup with every registered section: format 3 when a section added something. */
	exportBackup(now?: Date): Promise<Backup>;
	/**
	 * Adds a section to backups (one per id). Values it covers stay out of `data`, so a plugin that
	 * keeps them sealed decides how they leave the device.
	 */
	backupSection(id: string, section: BackupSection): void;
	/** `sections` in a parsed backup are the file's own, unread: their plugins open them. */
	parseBackup(text: string): ParsedBackup;
	/**
	 * `replace` clears every entry backups carry first; `merge` keeps what the backup lacks. Returns
	 * false when something couldn't be saved: `replace` then puts the previous data back.
	 */
	importData(backup: Backup, mode: 'replace' | 'merge'): boolean;
	/** Saved keys no registered plugin claims. */
	unclaimed(): UnclaimedKey[];
	/** Deletes unclaimed keys (claimed keys are refused). */
	removeUnclaimed(keys: string[]): void;

	/**
	 * Puts a layer over the current adapter (layers stack, the last one on top), then `reload()`s.
	 * Values already saved stay where they are: converting them is the layer's job.
	 */
	layer(wrap: StorageLayer): void;
	/**
	 * Forgets what this tab knows about saved data, for when a layer's view of it changed (unlocked,
	 * locked, or another tab re-sealed): migrations run again where needed and change listeners
	 * hear `null`. A migrated copy that storage couldn't save yet is kept.
	 */
	reload(): void;

	/** Asks the browser not to evict this site's data under storage pressure. */
	requestPersistence(): Promise<'granted' | 'denied' | 'unsupported'>;
	persisted(): Promise<boolean | 'unsupported'>;
};

export type StorageOptions = {
	adapter?: StorageAdapter | undefined;
	/** Defaults to `app:`. */
	prefix?: string | undefined;
	/** Written into backups and checked on import. */
	appName?: string | undefined;
	/** Where unexpected errors (a failing migration) are reported. */
	onError?: ((error: unknown) => void) | undefined;
	/** The registered blob collections, which `groups()` lists beside the entries. */
	collections?: (() => Collection[]) | undefined;
};

/** Values were JSON, except a few raw strings older apps saved. */
function decode(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** Asks the browser not to evict this site's data under storage pressure. */
export async function requestPersistence(): Promise<'granted' | 'denied' | 'unsupported'> {
	const storage = globalThis.navigator?.storage;
	if (!storage?.persist) return 'unsupported';
	try {
		return (await storage.persist()) ? 'granted' : 'denied';
	} catch {
		return 'denied';
	}
}

/** Whether the browser has agreed to keep this site's data under storage pressure. */
export async function persisted(): Promise<boolean | 'unsupported'> {
	const storage = globalThis.navigator?.storage;
	if (!storage?.persisted) return 'unsupported';
	try {
		return await storage.persisted();
	} catch {
		return false;
	}
}

const NAMESPACE = /^[a-z0-9][a-z0-9-]*$/;
const NAME = /^[^\s]+$/;

export function createStorage(options: StorageOptions = {}): StorageRegistry {
	const prefix = options.prefix ?? 'app:';
	let adapter = options.adapter ?? localStorageAdapter();
	const appName = options.appName ?? 'xcwds';
	const onError = options.onError ?? ((error) => console.error(error));

	const entries = new Map<string, Entry<unknown>>();
	/** The prefixed entries among `entries`. */
	const prefixed = new Set<PrefixEntry<unknown>>();
	/**
	 * A namespace's migrated data that couldn't be saved (storage full): `before` is what storage
	 * holds, `data` the migrated values (plus any changes since), saved together with the version.
	 */
	type Pending = { target: number; before: Record<string, string>; data: Record<string, unknown> };
	type Ns = {
		migrations: Migration[];
		migrated: number | null;
		failed: boolean;
		pending: Pending | null;
	};
	const namespaces = new Map<string, Ns>();
	const failing = new Set<string>();
	const changeListeners = new Set<ChangeListener>();
	const emit = (key: string | null, value: unknown) => {
		for (const l of [...changeListeners]) l(key, value);
	};
	const failureListeners = new Set<SaveFailureListener>();
	const sections = new Map<string, BackupSection>();
	const covered = (key: string) => [...sections.values()].some((s) => s.covers(key));
	let stop: (() => void) | null = null;

	const nsPrefix = (ns: string) => (ns ? `${prefix}${ns}:` : prefix);
	const versionKey = (ns: string) => (ns ? `${prefix}version:${ns}` : `${prefix}version`);
	const isVersionKey = (key: string) =>
		key === `${prefix}version` || key.startsWith(`${prefix}version:`);
	const namespace = (ns: string): Ns => {
		let n = namespaces.get(ns);
		if (!n)
			namespaces.set(ns, (n = { migrations: [], migrated: null, failed: false, pending: null }));
		return n;
	};
	const latestVersion = (ns: string) =>
		Math.max(0, ...(namespaces.get(ns)?.migrations.map((m) => m.to) ?? []));

	/**
	 * The entry for a full key, exact or one id of a prefixed entry (`of` is that prefixed
	 * entry), or undefined when no entry claims it.
	 */
	function claim(key: string): { entry: Entry<unknown>; of: Entry<unknown> } | undefined {
		const e = entries.get(key);
		if (e && !e.prefix) return { entry: e, of: e };
		for (const p of prefixed)
			if (key.length > p.key.length && key.startsWith(p.key))
				return { entry: p.at(key.slice(p.key.length)), of: p };
		return undefined;
	}

	/** The namespace that owns `key`: its entry's, or the registered namespace it's under. */
	function owner(key: string): string | undefined {
		const e = claim(key);
		if (e) return e.entry.namespace;
		let best: string | undefined;
		for (const ns of namespaces.keys()) {
			if (ns && key.startsWith(nsPrefix(ns)) && (!best || ns.length > best.length)) best = ns;
		}
		return best;
	}

	function keysOf(ns: string, available: Iterable<string>, extra: string[] = []): string[] {
		const out = new Set<string>();
		for (const e of entries.values()) if (e.namespace === ns && !e.prefix) out.add(e.key);
		const mine = [...prefixed].filter((p) => p.namespace === ns);
		for (const key of available) {
			if (ns && key.startsWith(nsPrefix(ns)) && !isVersionKey(key)) out.add(key);
			if (mine.some((p) => key.length > p.key.length && key.startsWith(p.key))) out.add(key);
			if (extra.includes(key)) out.add(key);
		}
		return [...out];
	}

	/** Runs `migrations` newer than `from` over `data`, in order. */
	function upgrade(ns: string, data: Record<string, unknown>, from: number) {
		const pending = namespace(ns)
			.migrations.filter((m) => m.to > from)
			.sort((a, b) => a.to - b.to);
		for (const m of pending) m.run(data);
	}

	/** Brings this device's data for `ns` up to the newest registered migration, once. */
	function ensure(ns: string): void {
		const n = namespace(ns);
		const target = latestVersion(ns);
		if (n.pending) {
			// Another tab may have saved the migration since; its data then wins over this copy.
			try {
				const saved = Number(adapter.get(versionKey(ns)) ?? 0) || 0;
				if (saved >= n.pending.target) {
					n.pending = null;
					n.migrated = saved;
				}
			} catch {
				// Blocked storage: keep serving the copy in memory.
			}
			return;
		}
		if (n.failed || (n.migrated !== null && n.migrated >= target)) return;
		const data: Record<string, unknown> = {};
		const before: Record<string, string> = {};
		let current: number;
		try {
			current = Number(adapter.get(versionKey(ns)) ?? 0) || 0;
			if (current < target) {
				const extra = n.migrations.flatMap((m) => m.keys ?? []);
				for (const key of keysOf(ns, adapter.keys(), extra)) {
					const text = adapter.get(key);
					if (text === null) continue;
					data[key] = decode(text);
					before[key] = text;
				}
			}
		} catch {
			// Storage is blocked: nothing to migrate this time.
			n.failed = true;
			return;
		}
		if (current < target) {
			try {
				upgrade(ns, data, current);
			} catch (cause) {
				// Leave the data as it was and try again next load.
				n.failed = true;
				onError(
					new XcwdsError(
						codes.STORAGE_MIGRATION,
						`Migrating saved data for "${ns || 'the app'}" failed.`,
						{ cause }
					)
				);
				return;
			}
			// Storage full: keep the migrated data in memory, so reads and backups still see it, and
			// save it with the next write to this namespace (#52). Storage keeps the old data and
			// version, so the migration also runs again next load.
			n.pending = { target, before, data };
			flush(ns, n);
			return;
		}
		// Newer data than this code knows is left untouched.
		n.migrated = Math.max(current, target);
	}

	/**
	 * Saves a namespace's pending migrated data together with its version, or puts storage back the
	 * way it was (as far as it lets us) so old data never sits under a new version or the reverse.
	 */
	function flush(ns: string, n: Ns): boolean {
		const p = n.pending!;
		const touched: string[] = [];
		try {
			for (const key of Object.keys(p.before)) {
				if (key in p.data) continue;
				adapter.remove(key);
				touched.push(key);
			}
			for (const [key, value] of Object.entries(p.data)) {
				const text = JSON.stringify(value);
				if (text === p.before[key]) continue;
				adapter.set(key, text);
				touched.push(key);
			}
			adapter.set(versionKey(ns), String(p.target));
		} catch {
			// Free the space the partial write took before restoring, then restore.
			for (const key of touched) {
				try {
					adapter.remove(key);
				} catch {
					// Blocked storage: nothing was written either.
				}
			}
			for (const key of touched) {
				const text = p.before[key];
				if (text === undefined) continue;
				try {
					adapter.set(key, text);
				} catch {
					// It fitted before; nothing more can be done here.
				}
			}
			return false;
		}
		n.pending = null;
		n.migrated = p.target;
		return true;
	}

	/** Changes an entry in a namespace whose migration isn't saved yet, then tries to save it. */
	function writePending(e: Entry<unknown>, value: unknown): boolean {
		const n = namespace(e.namespace);
		if (value === undefined) delete n.pending!.data[e.key];
		else n.pending!.data[e.key] = value;
		return flush(e.namespace, n);
	}

	/** A prefixed entry holds no value of its own (its ids do), so writing to it is a mistake. */
	function exact(e: Entry<unknown>) {
		if (e.prefix)
			throw new XcwdsError(
				codes.STORAGE_KEY,
				`"${e.key}" is a prefixed entry: read and write one id with \`at(id)\`.`
			);
	}

	/** The ids saved under `p`, including a migration's that isn't saved yet. */
	function idsOf(p: Entry<unknown>): string[] {
		ensure(p.namespace);
		const pending = namespaces.get(p.namespace)?.pending;
		const keys = pending ? Object.keys(pending.data) : safeKeys();
		return keys
			.filter((key) => key.length > p.key.length && key.startsWith(p.key))
			.map((key) => key.slice(p.key.length))
			.sort();
	}

	/** The exact entries `list` covers: each saved id of a prefixed entry, the rest as they are. */
	function expand(list: Iterable<Entry<unknown>>): Entry<unknown>[] {
		return [...list].flatMap((e) =>
			e.prefix ? idsOf(e).map((id) => (e as PrefixEntry<unknown>).at(id)) : [e]
		);
	}

	function read<T>(e: Entry<T>): T | undefined {
		// Reads never throw: a prefixed entry has no value of its own (`keys()` lists its ids).
		if (e.prefix) return undefined;
		ensure(e.namespace);
		const pending = namespaces.get(e.namespace)?.pending;
		if (pending) {
			const value = pending.data[e.key];
			try {
				return value === undefined ? undefined : e.parse(structuredClone(value));
			} catch {
				return undefined;
			}
		}
		try {
			const text = adapter.get(e.key);
			return text == null ? undefined : e.parse(decode(text));
		} catch {
			return undefined;
		}
	}

	function write<T>(e: Entry<T>, value: T): boolean {
		exact(e);
		ensure(e.namespace);
		if (namespaces.get(e.namespace)?.pending) {
			let copy: unknown;
			try {
				copy = JSON.parse(JSON.stringify(value));
			} catch {
				return false;
			}
			return writePending(e, copy);
		}
		try {
			adapter.set(e.key, JSON.stringify(value));
			return true;
		} catch {
			return false;
		}
	}

	function remove(e: Entry<unknown>): boolean {
		exact(e);
		ensure(e.namespace);
		if (namespaces.get(e.namespace)?.pending) return writePending(e, undefined);
		try {
			adapter.remove(e.key);
			return true;
		} catch {
			return false;
		}
	}

	function writable(): boolean {
		const probe = `${prefix}probe`;
		try {
			adapter.set(probe, '1');
			adapter.remove(probe);
			return true;
		} catch {
			return false;
		}
	}

	function latest<T>(e: Entry<T>, current: T | undefined, { unsaved = false } = {}) {
		if (unsaved) return current;
		// Start from what's saved whenever storage can be read, even when it's full: falling back
		// to this tab's copy then could save over another tab's changes.
		try {
			adapter.get(e.key);
		} catch {
			return current;
		}
		return read(e);
	}

	/** Removes `list` (every id of a prefixed entry); returns the keys it covered. */
	function clear(list: Entry<unknown>[] = [...entries.values()]): string[] {
		const all = expand(list);
		for (const e of all) remove(e);
		return all.map((e) => e.key);
	}

	function safeKeys(): string[] {
		try {
			return adapter.keys();
		} catch {
			return [];
		}
	}

	const unclaimedNamespace = (key: string) => key.slice(prefix.length).split(':')[0] ?? '';

	function unclaimed(): UnclaimedKey[] {
		// Keys a migration that isn't saved yet moves away from still hold its only saved source.
		const migrating = new Set<string>();
		for (const n of namespaces.values())
			for (const key of Object.keys(n.pending?.before ?? {})) migrating.add(key);
		return safeKeys()
			.filter((key) => key.startsWith(prefix) && !isVersionKey(key) && key !== `${prefix}probe`)
			.filter((key) => owner(key) === undefined && !migrating.has(key))
			.map((key) => ({ key, namespace: unclaimedNamespace(key) }));
	}

	/** The schema version this device's data for `ns` is at, or 0. */
	function savedVersion(ns: string): number {
		try {
			const version = Number(adapter.get(versionKey(ns)) ?? 0);
			return Number.isInteger(version) && version > 0 ? version : 0;
		} catch {
			return 0;
		}
	}

	/**
	 * The schema version `ns`'s data is read at: the newest, unless its migration couldn't run yet
	 * (a layer that's locked), when reads still return the saved data's older version.
	 */
	function readVersion(ns: string): number {
		ensure(ns);
		const n = namespace(ns);
		if (n.pending) return n.pending.target;
		return n.migrated ?? savedVersion(ns);
	}

	function exportData(now = new Date()): Backup {
		const data: Record<string, unknown> = {};
		for (const e of expand(entries.values())) {
			if (!e.backup || covered(e.key)) continue;
			const value = read(e);
			if (value !== undefined) data[e.key] = value;
		}
		const versions: Record<string, number> = {};
		for (const ns of namespaces.keys()) versions[ns] = readVersion(ns);
		const extra: Record<string, unknown> = {};
		const extraVersions: Record<string, number> = {};
		for (const { key, namespace: ns } of unclaimed()) {
			const text = adapter.get(key);
			if (text === null) continue;
			extra[key] = decode(text);
			const version = savedVersion(ns);
			if (version > 0) extraVersions[ns] = version;
		}
		return {
			app: appName,
			format: 2,
			exportedAt: now.toISOString(),
			versions,
			data,
			unclaimed: extra,
			unclaimedVersions: extraVersions
		};
	}

	function parseBackup(text: string): ParsedBackup {
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			return { ok: false, error: "This file isn't a backup (it's not valid JSON)." };
		}
		if (!isRecord(raw) || raw.app !== appName || !isRecord(raw.data))
			return { ok: false, error: "This file isn't a backup from this app." };
		// Backups made before namespaces had one `schemaVersion`: the app's own.
		const versions: Record<string, number> = {};
		if (raw.format === undefined) versions[''] = raw.schemaVersion as number;
		else if (raw.format !== 2 && raw.format !== 3)
			return { ok: false, error: 'This backup has an unknown format.' };
		else if (isRecord(raw.versions)) {
			// A namespace's unclaimed data only has a version when nothing claimed it at export.
			if (isRecord(raw.unclaimedVersions)) Object.assign(versions, raw.unclaimedVersions);
			Object.assign(versions, raw.versions);
		} else return { ok: false, error: 'This backup has an unknown format.' };
		const unclaimedVersions: Record<string, number> = {};
		for (const [ns, version] of Object.entries(versions)) {
			if (typeof version !== 'number' || !Number.isInteger(version) || version < 0)
				return { ok: false, error: 'This backup has an unknown format version.' };
			// A namespace no plugin here registers (one that was removed) keeps its data as
			// unclaimed, with its version, instead of making the whole backup look too new (#51).
			if (!namespaces.has(ns)) {
				if (version > 0) unclaimedVersions[ns] = version;
				continue;
			}
			if (version > latestVersion(ns))
				return {
					ok: false,
					error: 'This backup is from a newer version of the app. Update the app and try again.'
				};
		}
		const upgraded = structuredClone(raw.data) as Record<string, unknown>;
		// Data a removed plugin left, for a plugin that's back: import it as that plugin's own.
		if (isRecord(raw.unclaimed))
			for (const [key, value] of Object.entries(raw.unclaimed))
				if (!(key in upgraded) && owner(key) !== undefined) upgraded[key] = structuredClone(value);
		const byNs = new Map<string, Record<string, unknown>>();
		const handled = new Set<string>();
		for (const [key, value] of Object.entries(upgraded)) {
			const ns =
				owner(key) ??
				[...namespaces.entries()].find(([, n]) =>
					n.migrations.some((m) => m.keys?.includes(key))
				)?.[0];
			if (ns === undefined) continue;
			handled.add(key);
			if (!byNs.has(ns)) byNs.set(ns, {});
			byNs.get(ns)![key] = value;
		}
		const data: Record<string, unknown> = {};
		const found = new Set<Entry<unknown>>();
		const skipped: string[] = [];
		const unclaimedData: Record<string, unknown> = isRecord(raw.unclaimed)
			? { ...raw.unclaimed }
			: {};
		for (const [ns, subset] of byNs) {
			try {
				upgrade(ns, subset, versions[ns] ?? 0);
			} catch {
				return { ok: false, error: "This backup's data couldn't be upgraded." };
			}
			for (const [key, value] of Object.entries(subset)) {
				const c = claim(key);
				// An entry kept out of backups is never imported, whatever a file carries.
				const parsed = c?.entry.backup ? c.entry.parse(value) : undefined;
				if (c && parsed !== undefined) {
					data[key] = parsed;
					// A prefixed entry is listed once, however many ids the backup has.
					found.add(c.of);
				} else skipped.push(key);
			}
		}
		for (const key of Object.keys(upgraded)) {
			if (handled.has(key)) continue;
			if (key.startsWith(prefix) && !isVersionKey(key)) unclaimedData[key] = upgraded[key];
			else skipped.push(key);
		}
		for (const key of Object.keys(unclaimedData)) {
			if (owner(key) !== undefined || !key.startsWith(prefix) || isVersionKey(key))
				delete unclaimedData[key];
		}
		const backup: Backup = {
			app: appName,
			format: isRecord(raw.sections) ? 3 : 2,
			exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
			versions: Object.fromEntries([...namespaces.keys()].map((ns) => [ns, latestVersion(ns)])),
			data,
			unclaimed: unclaimedData,
			unclaimedVersions: Object.fromEntries(
				Object.entries(unclaimedVersions).filter(([ns]) =>
					Object.keys(unclaimedData).some((key) => unclaimedNamespace(key) === ns)
				)
			)
		};
		if (isRecord(raw.sections)) backup.sections = structuredClone(raw.sections);
		return { ok: true, backup, found: [...found], skipped };
	}

	function importData(backup: Backup, mode: 'replace' | 'merge'): boolean {
		if (mode === 'merge') return applyBackup(backup, mode);
		// Replace clears everything first, so a write that doesn't fit would leave neither the old
		// data nor the whole backup (#52): remember what's there and put it back if one fails.
		const keys = new Set([
			...expand(entries.values()).map((e) => e.key),
			...Object.keys(backup.data),
			...Object.keys(backup.unclaimed ?? {})
		]);
		for (const key of Object.keys(backup.unclaimed ?? {}))
			if (key.startsWith(prefix)) keys.add(versionKey(unclaimedNamespace(key)));
		for (const { key } of unclaimed()) keys.add(key);
		for (const [ns, n] of namespaces) {
			keys.add(versionKey(ns));
			for (const key of Object.keys(n.pending?.before ?? {})) keys.add(key);
		}
		const saved = new Map<string, string | null>();
		try {
			for (const key of keys) saved.set(key, adapter.get(key));
		} catch {
			return false;
		}
		const pending = new Map([...namespaces].map(([ns, n]) => [ns, structuredClone(n.pending)]));
		const migrated = new Map([...namespaces].map(([ns, n]) => [ns, n.migrated]));
		if (applyBackup(backup, mode)) return true;
		// Free the space the import took, then restore what changed.
		const changed: string[] = [];
		for (const [key, text] of saved) {
			try {
				if (adapter.get(key) === text) continue;
				adapter.remove(key);
				changed.push(key);
			} catch {
				// Blocked storage: nothing was written either.
			}
		}
		for (const key of changed) {
			const text = saved.get(key);
			if (text === null || text === undefined) continue;
			try {
				adapter.set(key, text);
			} catch {
				// It fitted before; nothing more can be done here.
			}
		}
		for (const [ns, n] of namespaces) {
			n.pending = pending.get(ns) ?? null;
			n.migrated = migrated.get(ns) ?? null;
		}
		return false;
	}

	function applyBackup(backup: Backup, mode: 'replace' | 'merge'): boolean {
		if (mode === 'replace') clear([...entries.values()].filter((e) => e.backup));
		let ok = true;
		for (const [key, value] of Object.entries(backup.data)) {
			const e = claim(key)?.entry;
			if (e?.backup) ok = write(e, value) && ok;
		}
		// Unclaimed data goes in per namespace, with its schema version, so a plugin that comes
		// back migrates it from the right version (#51).
		const incoming = new Map<string, [string, unknown][]>();
		for (const [key, value] of Object.entries(backup.unclaimed ?? {})) {
			if (owner(key) !== undefined || !key.startsWith(prefix) || isVersionKey(key)) continue;
			const ns = unclaimedNamespace(key);
			if (!incoming.has(ns)) incoming.set(ns, []);
			incoming.get(ns)!.push([key, value]);
		}
		const present = unclaimed();
		for (const [ns, list] of incoming) {
			const version = backup.unclaimedVersions?.[ns] ?? 0;
			const same = namespaces.has(ns) || savedVersion(ns) === version;
			const mine = present.filter((u) => u.namespace === ns).map((u) => u.key);
			// Data at another version can't be mixed: merge keeps this device's, replace takes the
			// backup's whole.
			if (!same && mode === 'merge' && mine.length) continue;
			try {
				if (!same) for (const key of mine) adapter.remove(key);
				for (const [key, value] of list)
					if (mode === 'replace' || !same || adapter.get(key) === null)
						adapter.set(key, JSON.stringify(value));
				if (!same) {
					if (version > 0) adapter.set(versionKey(ns), String(version));
					else adapter.remove(versionKey(ns));
				}
			} catch {
				ok = false;
			}
		}
		return ok;
	}

	const registry: StorageRegistry = {
		prefix,
		scope(ns) {
			if (ns !== '' && !NAMESPACE.test(ns))
				throw new XcwdsError(codes.STORAGE_KEY, `"${ns}" isn't a valid storage namespace.`);
			if (ns === 'version')
				throw new XcwdsError(codes.STORAGE_KEY, '"version" is reserved as a namespace.');
			namespace(ns);
			const { scope: _scope, ...rest } = registry;
			return {
				...rest,
				namespace: ns,
				entry<T>(name: string, opts: EntryOptions<T>): PrefixEntry<T> & Entry<T> {
					if (!NAME.test(name))
						throw new XcwdsError(codes.STORAGE_KEY, `"${name}" isn't a valid entry name.`);
					const isPrefix = opts.prefix === true;
					const key = opts.key ?? `${nsPrefix(ns)}${name}${isPrefix ? ':' : ''}`;
					if (
						!key.startsWith(prefix) ||
						key === prefix ||
						isVersionKey(key) ||
						key === `${prefix}probe`
					)
						throw new XcwdsError(codes.STORAGE_KEY, `"${key}" isn't a valid storage key.`);
					if (entries.has(key))
						throw new XcwdsError(
							codes.STORAGE_DUPLICATE_KEY,
							`The storage key "${key}" is already registered.`
						);
					if (typeof opts.parse !== 'function')
						throw new XcwdsError(codes.STORAGE_KEY, `The entry "${key}" needs a parse function.`);
					if (isPrefix && !key.endsWith(':'))
						throw new XcwdsError(
							codes.STORAGE_KEY,
							`The prefixed entry "${key}" needs a key that ends with ":".`
						);
					// An exact key under a prefix, or two prefixes inside each other, would let two
					// entries claim the same key.
					const clash = [...entries.values()].find((e) =>
						isPrefix
							? e.key.startsWith(key) || (e.prefix && key.startsWith(e.key))
							: e.prefix && key.startsWith(e.key)
					);
					if (clash)
						throw new XcwdsError(
							codes.STORAGE_DUPLICATE_KEY,
							`The storage key "${key}" overlaps "${clash.key}", which is already registered.`
						);
					for (const flag of ['backup', 'sensitive', 'prefix'] as const)
						if (opts[flag] !== undefined && typeof opts[flag] !== 'boolean')
							throw new XcwdsError(
								codes.STORAGE_KEY,
								`The entry "${key}" has a \`${flag}\` that isn't true or false.`
							);
					const e: Entry<T> = {
						key,
						label: opts.label,
						parse: opts.parse,
						group: opts.group ?? (ns || name.split(':')[0]!),
						namespace: ns,
						backup: opts.backup ?? true,
						sensitive: opts.sensitive ?? false,
						prefix: false
					};
					if (!isPrefix) {
						entries.set(key, e as Entry<unknown>);
						// The overloads give callers `Entry<T>` here: only `prefix: true` gets a PrefixEntry.
						return e as PrefixEntry<T>;
					}
					const p: PrefixEntry<T> = {
						...e,
						prefix: true,
						at(id) {
							if (typeof id !== 'string' || !NAME.test(id))
								throw new XcwdsError(codes.STORAGE_KEY, `"${id}" isn't a valid id for "${key}".`);
							return { ...e, key: `${key}${id}` };
						}
					};
					entries.set(key, p as Entry<unknown>);
					prefixed.add(p as PrefixEntry<unknown>);
					return p;
				},
				migration(m: Migration) {
					if (!Number.isInteger(m.to) || m.to < 1)
						throw new XcwdsError(
							codes.STORAGE_MIGRATION,
							'A migration needs an integer `to` of 1 or more.'
						);
					const n = namespace(ns);
					if (n.migrations.some((x) => x.to === m.to))
						throw new XcwdsError(
							codes.STORAGE_MIGRATION,
							`"${ns || 'the app'}" already has a migration to version ${m.to}.`
						);
					n.migrations.push(m);
				}
			};
		},
		entries: () => [...entries.values()],
		groups() {
			const out = new Map<string, Group>();
			const group = (id: string) => {
				if (!out.has(id))
					out.set(id, { id, label: '', entries: [], collections: [], sensitive: false });
				return out.get(id)!;
			};
			for (const e of entries.values()) {
				const g = group(e.group);
				g.entries.push(e);
				if (e.sensitive) g.sensitive = true;
			}
			for (const c of options.collections?.() ?? []) {
				const g = group(c.group);
				g.collections.push(c);
				if (c.sensitive) g.sensitive = true;
			}
			// Named after what's in it, e.g. "Home shortcuts" or "Workout, Workout history".
			for (const g of out.values())
				g.label = [...g.entries, ...g.collections].map((x) => x.label).join(', ');
			return [...out.values()];
		},
		read,
		keys(e) {
			if (!e?.prefix) throw new XcwdsError(codes.STORAGE_KEY, 'keys() takes a prefixed entry.');
			return idsOf(e);
		},
		write,
		remove,
		latest,
		update(e, current, change, opts = {}) {
			const value = change(latest(e, current, opts));
			const saved = value === undefined ? remove(e) : write(e, value);
			return { value, saved };
		},
		writable,
		clear(list) {
			const keys = clear(list);
			// This tab's own clears reach its listeners too, so what's showing follows.
			if (list) for (const key of keys) emit(key, undefined);
			else emit(null, undefined);
		},
		saveResult(e, saved, { explicit = false } = {}) {
			if (saved) {
				failing.delete(e.key);
				return true;
			}
			if (failing.has(e.key) && !explicit) return false;
			failing.add(e.key);
			if (failureListeners.size === 0) onError(new Error(`Couldn't save "${e.label}".`));
			for (const l of failureListeners) l(e, { explicit });
			return false;
		},
		hasUnsavedChanges: (e) => failing.has(e.key),
		onSaveFailure(listener) {
			failureListeners.add(listener);
			return () => failureListeners.delete(listener);
		},
		onChange(listener) {
			changeListeners.add(listener);
			return () => changeListeners.delete(listener);
		},
		startSync(target = globalThis as unknown as EventTarget) {
			stop?.();
			if (typeof target?.addEventListener !== 'function') return () => {};
			const handler = (event: Event) => {
				const { key, storageArea } = event as StorageEvent;
				if (storageArea && storageArea !== globalThis.localStorage) return;
				if (
					key !== null &&
					(!key.startsWith(prefix) || isVersionKey(key) || key === `${prefix}probe`)
				)
					return;
				const e = key === null ? undefined : claim(key)?.entry;
				const value = e ? read(e) : undefined;
				for (const l of changeListeners) l(key, value);
			};
			target.addEventListener('storage', handler);
			stop = () => {
				target.removeEventListener('storage', handler);
				stop = null;
			};
			return stop;
		},
		stopSync: () => stop?.(),
		layer(wrap) {
			if (typeof wrap !== 'function')
				throw new XcwdsError(codes.STORAGE_KEY, 'A storage layer must be a function.');
			const next = wrap(adapter);
			for (const method of ['get', 'set', 'remove', 'keys'] as const)
				if (typeof next?.[method] !== 'function')
					throw new XcwdsError(
						codes.STORAGE_KEY,
						`A storage layer must return an adapter with \`${method}\`.`
					);
			adapter = next;
			registry.reload();
		},
		reload() {
			for (const n of namespaces.values()) {
				if (n.pending) continue;
				n.migrated = null;
				n.failed = false;
			}
			emit(null, undefined);
		},
		exportData,
		async exportBackup(now = new Date()) {
			// Migrations first, so a section exports the same data `data` is read from.
			for (const ns of namespaces.keys()) ensure(ns);
			const added: Record<string, unknown> = {};
			for (const [id, section] of sections) {
				const value = await section.export();
				if (value !== undefined) added[id] = value;
			}
			const backup = exportData(now);
			return Object.keys(added).length ? { ...backup, format: 3, sections: added } : backup;
		},
		backupSection(id, section) {
			if (!NAME.test(id) || sections.has(id))
				throw new XcwdsError(
					codes.STORAGE_KEY,
					`"${id}" isn't a valid backup section id, or it's already registered.`
				);
			if (typeof section?.covers !== 'function' || typeof section.export !== 'function')
				throw new XcwdsError(
					codes.STORAGE_KEY,
					'A backup section needs `covers` and `export` functions.'
				);
			sections.set(id, section);
		},
		parseBackup,
		importData(backup, mode) {
			const ok = importData(backup, mode);
			emit(null, undefined);
			return ok;
		},
		unclaimed,
		removeUnclaimed(keys) {
			const allowed = new Map(unclaimed().map((u) => [u.key, u.namespace]));
			const touched = new Set<string>();
			for (const key of keys) {
				if (!allowed.has(key)) continue;
				try {
					adapter.remove(key);
					touched.add(allowed.get(key)!);
				} catch {
					// Blocked storage: nothing to delete.
				}
			}
			// A removed plugin's version goes with the last of its data, so it can't label data
			// imported later.
			const left = new Set(unclaimed().map((u) => u.namespace));
			for (const ns of touched) {
				if (left.has(ns) || namespaces.has(ns)) continue;
				try {
					adapter.remove(versionKey(ns));
				} catch {
					// Blocked storage: nothing to delete.
				}
			}
		},
		requestPersistence,
		persisted
	};
	return registry;
}
