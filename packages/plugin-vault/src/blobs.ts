/**
 * The vault's blob layer (#149): keeps the blobs of sensitive collections (photos, shared images,
 * recordings) sealed in IndexedDB, as the storage layer (`./vault`) does for sensitive groups.
 * Each blob is sealed in chunks, so a 4 MB photo is never held as a whole second copy while it's
 * sealed or opened: AES-GCM with a fresh IV per chunk, bound to the collection, the id, the
 * chunk's place and their count, so chunks moved, reordered, dropped or added don't open. Its
 * size, type and `meta` are sealed too; the row shows only a rounded size and when it was saved.
 *
 * Locked (on, without the key), a sensitive collection can't be read, listed or saved: the layer
 * rejects, so `app.blobs` reads it as empty and its `put` returns false. Deleting and clearing
 * still work, so a reset clears what it can't read. Lock-agnostic, like `./vault`: whoever opens
 * the vault passes the same key to `unlock`, and `sealAll` and `openAll` convert existing blobs
 * when it's turned on or off.
 *
 * Imported at prerender too, so nothing touches browser globals until a function runs.
 */
import { XcwdsError, codes, type BlobBackend, type BlobLayer, type BlobRow } from '@xcwds/core';
import { open, parseSealed, seal, type Sealed } from './seal.js';

/** Bytes of plaintext per chunk. */
export const CHUNK_BYTES = 1024 * 1024;
/** Sizes on the row are rounded up to this, so they don't give the exact size away. */
export const SIZE_STEP = 64 * 1024;
/** What a sealed row says its type is. */
export const SEALED_TYPE = 'application/octet-stream';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 1;

export type BlobVault = {
	/** On (`enabled()`), and the key isn't in memory: sensitive collections can't be used. */
	readonly locked: boolean;
	/** Install with `app.blobs.layer(vault.layer)`. */
	readonly layer: BlobLayer;
	/** Uses `key` from now on: the one the storage vault's `unlock` or `enable` accepted. */
	unlock(key: CryptoKey): void;
	/** Forgets the key. */
	lock(): void;
	/**
	 * Seals every plaintext blob in the sensitive collections, one at a time, after the vault is
	 * turned on. False when one couldn't be sealed (it's left as it was) or there's no key; run it
	 * again to finish. `progress` gets how many are done of how many.
	 */
	sealAll(progress?: (done: number, total: number) => void): Promise<boolean>;
	/** Opens every sealed blob back to plaintext, before the vault is turned off. As `sealAll`. */
	openAll(progress?: (done: number, total: number) => void): Promise<boolean>;
};

export type BlobVaultOptions = {
	/** The keys of the sensitive collections (`app.blobs.collections()`, filtered). */
	sensitive: () => string[];
	/** Whether the vault is on (`createVault(...).state.enabled`). */
	enabled: () => boolean;
	/** Bytes of plaintext per chunk (tests use small ones). */
	chunkBytes?: number;
};

/** What a sealed row keeps in `meta`: the sealed head, holding what the blob really is. */
type SealedMeta = { vault: 1; head: Sealed };
/** The head: the blob's real size, type and meta, and how it was chunked. */
type Head = { size: number; type: string; chunk: number; meta?: unknown };

function sealedMeta(meta: unknown): SealedMeta | undefined {
	if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined;
	const { vault, head } = meta as Record<string, unknown>;
	const parsed = vault === VERSION ? parseSealed(head) : undefined;
	return parsed ? { vault: VERSION, head: parsed } : undefined;
}

function parseHead(text: string | undefined): Head | undefined {
	if (text === undefined) return undefined;
	let v: unknown;
	try {
		v = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof v !== 'object' || v === null) return undefined;
	const { size, type, chunk, meta } = v as Record<string, unknown>;
	if (!Number.isSafeInteger(size) || (size as number) < 0) return undefined;
	if (!Number.isSafeInteger(chunk) || (chunk as number) < 1) return undefined;
	if (typeof type !== 'string') return undefined;
	return { size: size as number, type, chunk: chunk as number, meta };
}

const headContext = (collection: string, id: string) => `blob:${JSON.stringify([collection, id])}`;
const chunkData = (collection: string, id: string, index: number, count: number) =>
	new TextEncoder().encode(
		`xcwds-vault:v1:blob-chunk:${JSON.stringify([collection, id, index, count])}`
	);

/** How many chunks a blob of `size` bytes takes (an empty blob is one empty chunk). */
const chunkCount = (size: number, chunk: number) => Math.max(1, Math.ceil(size / chunk));

const roundSize = (size: number) => Math.ceil(size / SIZE_STEP) * SIZE_STEP;

const lockedError = () =>
	new XcwdsError(codes.LOCKED, 'Sensitive files are sealed until the app is unlocked.');

export function createBlobVault(options: BlobVaultOptions): BlobVault {
	const chunkBytes = options.chunkBytes ?? CHUNK_BYTES;
	if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1)
		throw new RangeError('chunkBytes must be a whole number of bytes.');
	let key: CryptoKey | null = null;
	let inner: BlobBackend | null = null;
	const isSensitive = (collection: string) => options.sensitive().includes(collection);

	/** Seals `row` with `k`, a chunk at a time. */
	async function sealRow(k: CryptoKey, row: BlobRow): Promise<BlobRow> {
		const { subtle } = globalThis.crypto;
		const size = row.blob.size;
		const count = chunkCount(size, chunkBytes);
		const parts: BlobPart[] = [];
		for (let i = 0; i < count; i++) {
			const plain = await row.blob.slice(i * chunkBytes, (i + 1) * chunkBytes).arrayBuffer();
			const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
			const data = await subtle.encrypt(
				{
					name: 'AES-GCM',
					iv: iv as BufferSource,
					additionalData: chunkData(row.collection, row.id, i, count) as BufferSource
				},
				k,
				plain
			);
			parts.push(iv, new Uint8Array(data));
		}
		const head: Head = { size, type: row.type, chunk: chunkBytes, meta: row.meta };
		const meta: SealedMeta = {
			vault: VERSION,
			head: await seal(k, JSON.stringify(head), headContext(row.collection, row.id))
		};
		return {
			collection: row.collection,
			id: row.id,
			blob: new Blob(parts, { type: SEALED_TYPE }),
			size: roundSize(size),
			type: SEALED_TYPE,
			created: row.created,
			meta
		};
	}

	/** The head of a sealed row, or undefined when it doesn't open. */
	async function openHead(
		k: CryptoKey,
		row: Pick<BlobRow, 'collection' | 'id'>,
		sealed: SealedMeta
	): Promise<Head | undefined> {
		return parseHead(await open(k, sealed.head, headContext(row.collection, row.id)));
	}

	/** Opens a sealed row a chunk at a time; undefined for a wrong key or changed data. */
	async function openRow(k: CryptoKey, row: BlobRow, sealed: SealedMeta) {
		const head = await openHead(k, row, sealed);
		if (!head) return undefined;
		const count = chunkCount(head.size, head.chunk);
		// Every chunk but the last is full; the blob must be exactly that long (nothing dropped or added).
		const last = head.size - (count - 1) * head.chunk;
		const sealedSize =
			(count - 1) * (IV_BYTES + head.chunk + TAG_BYTES) + IV_BYTES + last + TAG_BYTES;
		if (row.blob.size !== sealedSize) return undefined;
		const parts: BlobPart[] = [];
		let at = 0;
		try {
			for (let i = 0; i < count; i++) {
				const length = IV_BYTES + (i < count - 1 ? head.chunk : last) + TAG_BYTES;
				const bytes = new Uint8Array(await row.blob.slice(at, at + length).arrayBuffer());
				at += length;
				const plain = await globalThis.crypto.subtle.decrypt(
					{
						name: 'AES-GCM',
						iv: bytes.subarray(0, IV_BYTES) as BufferSource,
						additionalData: chunkData(row.collection, row.id, i, count) as BufferSource
					},
					k,
					bytes.subarray(IV_BYTES) as BufferSource
				);
				parts.push(new Uint8Array(plain));
			}
		} catch {
			return undefined;
		}
		return {
			...row,
			blob: new Blob(parts, { type: head.type }),
			size: head.size,
			type: head.type,
			meta: head.meta
		} satisfies BlobRow;
	}

	/** The key, or a rejection while locked (or while a sealed blob outlives the vault). */
	function needKey(): CryptoKey {
		if (!key) throw lockedError();
		return key;
	}

	const layer: BlobLayer = (below) => {
		inner = below;
		return {
			async put(row) {
				if (!isSensitive(row.collection) || !options.enabled()) return below.put(row);
				return below.put(await sealRow(needKey(), row));
			},
			async get(collection, id) {
				if (!isSensitive(collection)) return below.get(collection, id);
				// Locked means nothing of the collection is served, plaintext left over included.
				if (options.enabled()) needKey();
				const row = await below.get(collection, id);
				const sealed = row && sealedMeta(row.meta);
				if (!row || !sealed) return row;
				return openRow(needKey(), row, sealed);
			},
			async list(collection) {
				const rows = await below.list(collection);
				if (!isSensitive(collection)) return rows;
				if (options.enabled()) needKey();
				const out: Omit<BlobRow, 'blob'>[] = [];
				for (const row of rows) {
					const sealed = sealedMeta(row.meta);
					if (!sealed) {
						out.push(row);
						continue;
					}
					const head = await openHead(needKey(), row, sealed);
					// One that doesn't open (changed, or another key's) is left out, as `get` can't open it.
					if (head) out.push({ ...row, size: head.size, type: head.type, meta: head.meta });
				}
				return out;
			},
			delete: (collection, id) => below.delete(collection, id),
			clear: (collection) => below.clear(collection),
			...(below.close ? { close: () => below.close!() } : {})
		};
	};

	/** Converts each blob of the sensitive collections that `convert` wants to change. */
	async function convertAll(
		/** The row to save instead, `null` when it needs nothing (done meanwhile), undefined when it failed. */
		convert: (k: CryptoKey, row: BlobRow) => Promise<BlobRow | null | undefined>,
		wants: (row: Omit<BlobRow, 'blob'>) => boolean,
		progress?: (done: number, total: number) => void
	): Promise<boolean> {
		const k = key;
		const below = inner;
		if (!k || !below) return false;
		let ok = true;
		const todo: Omit<BlobRow, 'blob'>[] = [];
		for (const collection of options.sensitive()) {
			try {
				todo.push(...(await below.list(collection)).filter(wants));
			} catch {
				ok = false;
			}
		}
		let done = 0;
		progress?.(done, todo.length);
		for (const info of todo) {
			try {
				const row = await below.get(info.collection, info.id);
				const next = row && (await convert(k, row));
				if (next) await below.put(next);
				else if (next === undefined && row) ok = false;
			} catch {
				ok = false;
			}
			progress?.(++done, todo.length);
		}
		return ok;
	}

	return {
		get locked() {
			return options.enabled() && key === null;
		},
		layer,
		unlock(k) {
			key = k;
		},
		lock() {
			key = null;
		},
		sealAll: (progress) =>
			convertAll(
				(k, row) => (sealedMeta(row.meta) ? Promise.resolve(null) : sealRow(k, row)),
				(row) => !sealedMeta(row.meta),
				progress
			),
		openAll: (progress) =>
			convertAll(
				(k, row) => {
					const sealed = sealedMeta(row.meta);
					return sealed ? openRow(k, row, sealed) : Promise.resolve(null);
				},
				(row) => sealedMeta(row.meta) !== undefined,
				progress
			)
	};
}
