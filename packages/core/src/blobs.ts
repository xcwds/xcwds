/**
 * Files and images (#144): `app.blobs`, beside `app.storage`. Saved data is `localStorage`
 * (synchronous, strings, about 5 MB), and one phone photo is 1-4 MB, so blobs live in IndexedDB.
 * Collections are registered like storage entries (`app:<namespace>:<key>`, a label, a group).
 * Every call is async and never throws: blocked or missing IndexedDB reads as empty and writes
 * return false, like storage.
 */
import { XcwdsError, codes } from './errors.js';
import { persisted, requestPersistence } from './storage.js';

// ---------------------------------------------------------------------------------------------
// Backends

/** One saved blob as a backend keeps it. `meta` is JSON. */
export type BlobRow = {
	collection: string;
	id: string;
	blob: Blob;
	/** The blob's own size and type, kept apart so a layer may store something else in `blob`. */
	size: number;
	type: string;
	/** When it was saved, in ms since the epoch. */
	created: number;
	meta?: unknown;
};

/**
 * Where blobs are kept. Methods may reject (IndexedDB blocked, quota exceeded); the registry
 * catches. `list` returns rows without `blob`.
 */
export type BlobBackend = {
	put(row: BlobRow): Promise<void>;
	get(collection: string, id: string): Promise<BlobRow | undefined>;
	list(collection: string): Promise<Omit<BlobRow, 'blob'>[]>;
	delete(collection: string, id: string): Promise<void>;
	clear(collection: string): Promise<void>;
	/** Lets go of open connections (`app.close()`). */
	close?(): void;
};

/**
 * Wraps the backend beneath it, like `StorageLayer` (RFC decision 11) but async, so a plugin can
 * change how some collections are kept (#149: sealing sensitive ones) without the registry
 * knowing. A layer that can't serve a collection right now (locked) rejects.
 */
export type BlobLayer = (inner: BlobBackend) => BlobBackend;

const STORE = 'blobs';

function request<T>(r: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		// A quota error aborts the transaction; its `error` says why.
		tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
		tx.onerror = () => reject(tx.error);
	});
}

/** Every key of one collection: `[collection, id]` with any string id (arrays sort after strings). */
const range = (collection: string) => IDBKeyRange.bound([collection, ''], [collection, []]);

/**
 * IndexedDB: one database (`name`) with one object store keyed by `[collection, id]`. Nothing
 * touches `indexedDB` until the first call, so importing it during prerender is safe.
 */
export function indexedDbBlobs(name: string): BlobBackend {
	let opening: Promise<IDBDatabase> | null = null;

	function open(): Promise<IDBDatabase> {
		opening ??= new Promise<IDBDatabase>((resolve, reject) => {
			const factory = globalThis.indexedDB;
			if (!factory) throw new Error('IndexedDB is not available');
			const r = factory.open(name, 1);
			r.onupgradeneeded = () => {
				if (!r.result.objectStoreNames.contains(STORE))
					r.result.createObjectStore(STORE, { keyPath: ['collection', 'id'] });
			};
			r.onsuccess = () => {
				const db = r.result;
				// Another tab upgrading (or deleting) the database waits until this one lets go.
				db.onversionchange = () => {
					db.close();
					opening = null;
				};
				db.onclose = () => (opening = null);
				resolve(db);
			};
			r.onerror = () => reject(r.error);
			r.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
		}).catch((error: unknown) => {
			// Try again next time: a blocked open may succeed later.
			opening = null;
			throw error;
		});
		return opening;
	}

	async function write(run: (store: IDBObjectStore) => void): Promise<void> {
		const tx = (await open()).transaction(STORE, 'readwrite');
		const finished = done(tx);
		run(tx.objectStore(STORE));
		await finished;
	}

	return {
		put: (row) => write((store) => void store.put(row)),
		async get(collection, id) {
			const store = (await open()).transaction(STORE).objectStore(STORE);
			return (await request(store.get([collection, id]))) as BlobRow | undefined;
		},
		async list(collection) {
			const store = (await open()).transaction(STORE).objectStore(STORE);
			const rows = (await request(store.getAll(range(collection)))) as BlobRow[];
			return rows.map(({ blob: _blob, ...rest }) => rest);
		},
		delete: (collection, id) => write((store) => void store.delete([collection, id])),
		clear: (collection) => write((store) => void store.delete(range(collection))),
		close() {
			const current = opening;
			opening = null;
			void current?.then((db) => db.close()).catch(() => {});
		}
	};
}

/** An in-memory backend for tests and for environments without IndexedDB. */
export function memoryBlobs(): BlobBackend & { rows: Map<string, BlobRow> } {
	const rows = new Map<string, BlobRow>();
	const at = (collection: string, id: string) => JSON.stringify([collection, id]);
	return {
		rows,
		put: async (row) => void rows.set(at(row.collection, row.id), { ...row }),
		get: async (collection, id) => {
			const row = rows.get(at(collection, id));
			return row && { ...row };
		},
		list: async (collection) =>
			[...rows.values()]
				.filter((row) => row.collection === collection)
				.map(({ blob: _blob, ...rest }) => rest),
		delete: async (collection, id) => void rows.delete(at(collection, id)),
		clear: async (collection) => {
			for (const [key, row] of rows) if (row.collection === collection) rows.delete(key);
		}
	};
}

// ---------------------------------------------------------------------------------------------
// Collections

export type Collection<M = unknown> = {
	/** The full key, e.g. `app:camera:photos`. */
	readonly key: string;
	/** Human-readable, for Settings. */
	readonly label: string;
	/** Like a storage entry's group: "Clear data" clears blobs and entries by group. */
	readonly group: string;
	readonly namespace: string;
	/** Whether backups carry it. Always false for now: blobs stay out of backups. */
	readonly backup: boolean;
	/** Personal data a lock's reset clears, like a sensitive storage entry. */
	readonly sensitive: boolean;
	/** Checks a blob's `meta`: returns it if valid, otherwise `undefined`. */
	readonly validate: ((raw: unknown) => M | undefined) | undefined;
};

export type CollectionOptions<M> = {
	/** The collection's name within the namespace: `app:<namespace>:<key>`. */
	key: string;
	label: string;
	/** Defaults to the namespace (or the key at the root). */
	group?: string;
	/** Only `false` for now (the default): blobs stay out of backups. */
	backup?: boolean;
	/** `true` marks it as personal data, like a sensitive storage entry. */
	sensitive?: boolean;
	/** Checks the `meta` saved with each blob; without it, any small JSON is accepted. */
	validate?: (raw: unknown) => M | undefined;
};

/** A saved blob without its contents. */
export type BlobInfo<M = unknown> = {
	id: string;
	size: number;
	type: string;
	/** When it was saved, in ms since the epoch. */
	created: number;
	/** `undefined` when none was saved or what's saved no longer passes `validate`. */
	meta: M | undefined;
};

export type BlobUsage = { collection: Collection; count: number; bytes: number };

/** `key` is the collection's key, or null when this tab cleared several at once. */
export type BlobChangeListener = (key: string | null) => void;

/** The blob API every plugin gets as `app.blobs`, bound to its namespace. */
export type BlobScope = Omit<BlobRegistry, 'scope'> & {
	readonly namespace: string;
	/** Registers a collection under this namespace. */
	register<M = unknown>(options: CollectionOptions<M>): Collection<M>;
};

export type BlobRegistry = {
	scope(namespace: string): BlobScope;
	/** Every registered collection. */
	collections(): Collection[];

	/** Saves a blob; its id, or false if it couldn't be saved (unavailable, full, invalid meta). */
	put<M>(collection: Collection<M>, blob: Blob, meta?: M): Promise<string | false>;
	get<M>(
		collection: Collection<M>,
		id: string
	): Promise<{ blob: Blob; meta: M | undefined } | undefined>;
	/** The collection's blobs, newest first, without loading their contents. */
	list<M>(collection: Collection<M>): Promise<BlobInfo<M>[]>;
	/** False if it couldn't be deleted. */
	delete(collection: Collection, id: string): Promise<boolean>;
	/** Deletes every blob in the given collections (default: every registered one). */
	clear(collections?: Collection | Collection[]): Promise<boolean>;
	/** How many blobs each registered collection holds, and their total size in bytes. */
	usage(): Promise<BlobUsage[]>;

	/**
	 * Listens for changes other tabs make (through a `BroadcastChannel`), and for this tab's
	 * `clear()`.
	 */
	onChange(listener: BlobChangeListener): () => void;
	/** Puts a layer over the current backend (layers stack, the last one on top). */
	layer(wrap: BlobLayer): void;
	/** Closes the channel and the database (`app.close()`). */
	stop(): void;

	/**
	 * Asks the browser not to evict this site's data under storage pressure. Never called for you:
	 * Firefox asks the user, so call it after a user action and cope with a refusal.
	 */
	persist(): Promise<'granted' | 'denied' | 'unsupported'>;
	persisted(): Promise<boolean | 'unsupported'>;
};

export type BlobOptions = {
	/** Defaults to IndexedDB, in a database named `<prefix>blobs`. */
	backend?: BlobBackend | undefined;
	/** The storage prefix; defaults to `app:`. */
	prefix?: string | undefined;
};

const NAMESPACE = /^[a-z0-9][a-z0-9-]*$/;
const NAME = /^[^\s]+$/;
/** `meta` is for small things like a caption or a date, not for data of its own. */
const MAX_META = 64 * 1024;

/** `meta` as saved: JSON, small, and valid for the collection. `false` when it isn't. */
function checkMeta(collection: Collection, meta: unknown): unknown {
	if (meta === undefined) return undefined;
	let text: string | undefined;
	try {
		text = JSON.stringify(meta);
	} catch {
		return false;
	}
	if (text === undefined || text.length > MAX_META) return false;
	const copy: unknown = JSON.parse(text);
	if (!collection.validate) return copy;
	const valid = collection.validate(copy);
	return valid === undefined ? false : valid;
}

function readMeta<M>(collection: Collection<M>, meta: unknown): M | undefined {
	if (meta === undefined || !collection.validate) return meta as M | undefined;
	try {
		return collection.validate(meta);
	} catch {
		return undefined;
	}
}

export function createBlobs(options: BlobOptions = {}): BlobRegistry {
	const prefix = options.prefix ?? 'app:';
	let backend = options.backend ?? indexedDbBlobs(`${prefix}blobs`);
	const collections = new Map<string, Collection>();
	const listeners = new Set<BlobChangeListener>();
	const emit = (key: string | null) => {
		for (const l of [...listeners]) l(key);
	};

	let channel: BroadcastChannel | null | undefined;
	/** The tabs' channel, opened on first use; null where there's no `BroadcastChannel`. */
	function broadcast(): BroadcastChannel | null {
		if (channel !== undefined) return channel;
		if (typeof globalThis.BroadcastChannel !== 'function') return (channel = null);
		channel = new BroadcastChannel(`xcwds-blobs:${prefix}`);
		channel.onmessage = (event: MessageEvent) => {
			const key = (event.data as { key?: unknown } | null)?.key;
			if (key === null || (typeof key === 'string' && key.startsWith(prefix))) emit(key);
		};
		return channel;
	}
	const announce = (key: string | null) => {
		try {
			broadcast()?.postMessage({ key });
		} catch {
			// A closed channel: other tabs find out when they next read.
		}
	};

	const known = (c: Collection) => {
		if (collections.get(c?.key) !== c)
			throw new XcwdsError(codes.STORAGE_KEY, `"${c?.key}" isn't a registered blob collection.`);
	};

	const registry: BlobRegistry = {
		scope(ns) {
			if (ns !== '' && !NAMESPACE.test(ns))
				throw new XcwdsError(codes.STORAGE_KEY, `"${ns}" isn't a valid storage namespace.`);
			const { scope: _scope, ...rest } = registry;
			return {
				...rest,
				namespace: ns,
				register<M>(opts: CollectionOptions<M>): Collection<M> {
					const name = opts?.key;
					if (typeof name !== 'string' || !NAME.test(name))
						throw new XcwdsError(codes.STORAGE_KEY, `"${name}" isn't a valid collection key.`);
					const key = ns ? `${prefix}${ns}:${name}` : `${prefix}${name}`;
					if (collections.has(key))
						throw new XcwdsError(
							codes.STORAGE_DUPLICATE_KEY,
							`The blob collection "${key}" is already registered.`
						);
					if (typeof opts.label !== 'string' || opts.label.trim() === '')
						throw new XcwdsError(codes.STORAGE_KEY, `The blob collection "${key}" needs a label.`);
					for (const flag of ['backup', 'sensitive'] as const)
						if (opts[flag] !== undefined && typeof opts[flag] !== 'boolean')
							throw new XcwdsError(
								codes.STORAGE_KEY,
								`The blob collection "${key}" has a \`${flag}\` that isn't true or false.`
							);
					if (opts.backup)
						throw new XcwdsError(
							codes.STORAGE_KEY,
							`The blob collection "${key}" can't be backed up yet: blobs stay out of backups.`
						);
					if (opts.validate !== undefined && typeof opts.validate !== 'function')
						throw new XcwdsError(
							codes.STORAGE_KEY,
							`The blob collection "${key}" has a \`validate\` that isn't a function.`
						);
					const c: Collection<M> = {
						key,
						label: opts.label,
						group: opts.group ?? (ns || name.split(':')[0]!),
						namespace: ns,
						backup: false,
						sensitive: opts.sensitive ?? false,
						validate: opts.validate
					};
					collections.set(key, c as Collection);
					return c;
				}
			};
		},
		collections: () => [...collections.values()],

		async put(c, blob, meta) {
			known(c as Collection);
			if (typeof Blob === 'undefined' || !(blob instanceof Blob)) return false;
			let saved: unknown;
			try {
				saved = checkMeta(c as Collection, meta);
			} catch {
				return false;
			}
			if (saved === false) return false;
			const id = globalThis.crypto?.randomUUID?.();
			if (!id) return false;
			const row: BlobRow = {
				collection: c.key,
				id,
				blob,
				size: blob.size,
				type: blob.type,
				created: Date.now()
			};
			if (saved !== undefined) row.meta = saved;
			try {
				await backend.put(row);
			} catch {
				// Blocked, missing or full (QuotaExceededError): the caller says it wasn't saved.
				return false;
			}
			announce(c.key);
			return id;
		},
		async get(c, id) {
			known(c as Collection);
			try {
				const row = await backend.get(c.key, id);
				if (!row || typeof Blob === 'undefined' || !(row.blob instanceof Blob)) return undefined;
				return { blob: row.blob, meta: readMeta(c, row.meta) };
			} catch {
				return undefined;
			}
		},
		async list(c) {
			known(c as Collection);
			let rows: Omit<BlobRow, 'blob'>[];
			try {
				rows = await backend.list(c.key);
			} catch {
				return [];
			}
			return rows
				.map((row) => ({
					id: row.id,
					size: row.size,
					type: row.type,
					created: row.created,
					meta: readMeta(c, row.meta)
				}))
				.sort((a, b) => b.created - a.created);
		},
		async delete(c, id) {
			known(c);
			try {
				await backend.delete(c.key, id);
			} catch {
				return false;
			}
			announce(c.key);
			return true;
		},
		async clear(list) {
			const targets = list === undefined ? [...collections.values()] : [list].flat();
			for (const c of targets) known(c);
			let ok = true;
			for (const c of targets) {
				try {
					await backend.clear(c.key);
				} catch {
					ok = false;
				}
			}
			const key = targets.length === 1 ? targets[0]!.key : null;
			announce(key);
			// This tab's own clears reach its listeners too, so what's showing follows.
			emit(key);
			return ok;
		},
		async usage() {
			const out: BlobUsage[] = [];
			for (const c of collections.values()) {
				const rows = await registry.list(c);
				out.push({
					collection: c,
					count: rows.length,
					bytes: rows.reduce((sum, row) => sum + (Number(row.size) || 0), 0)
				});
			}
			return out;
		},

		onChange(listener) {
			listeners.add(listener);
			broadcast();
			return () => listeners.delete(listener);
		},
		layer(wrap) {
			if (typeof wrap !== 'function')
				throw new XcwdsError(codes.STORAGE_KEY, 'A blob layer must be a function.');
			const next = wrap(backend);
			for (const method of ['put', 'get', 'list', 'delete', 'clear'] as const)
				if (typeof next?.[method] !== 'function')
					throw new XcwdsError(
						codes.STORAGE_KEY,
						`A blob layer must return a backend with \`${method}\`.`
					);
			// Closing reaches the database at the bottom of the stack.
			if (!next.close && backend.close) next.close = backend.close.bind(backend);
			backend = next;
		},
		stop() {
			channel?.close();
			channel = undefined;
			backend.close?.();
		},

		persist: requestPersistence,
		persisted
	};
	return registry;
}
