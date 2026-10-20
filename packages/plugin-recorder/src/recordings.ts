/**
 * Recordings kept in the app (#150), in the blob store (`app.blobs`, #144). While recording, the
 * audio arrives in chunks every few seconds, and each is saved as it comes (a `-chunks`
 * collection), so a crash, a killed tab or a dead battery keeps everything up to the last chunk.
 * Stopping joins the chunks into one recording and deletes them; on the next start, chunks with
 * no recording still running are joined and kept as a recovered recording. "Still running"
 * includes other tabs: each open take holds a Web Lock (`navigator.locks`), and `recover` leaves a
 * take whose lock is held alone. Without the Locks API, it leaves takes with a chunk saved in the
 * last `staleAfter` ms.
 *
 * Both collections are personal (`sensitive`: a lock's reset clears them) and out of backups.
 * Framework-agnostic and safe to import during prerender: nothing here touches the browser until a
 * method is called.
 */
import type { BlobInfo, BlobScope, Collection } from '@xcwds/core';

/** A saved recording's `meta`. */
export type RecordingMeta = {
	/** Shown in the list; empty for none yet. */
	name: string;
	/** When recording started, in ms since the epoch. */
	recordedAt: number;
	/** How long it is, in ms, not counting pauses. */
	duration: number;
	/** Recovered from chunks after the app closed mid-recording. */
	recovered?: true;
};

/** A chunk's `meta`: which recording it belongs to, and where. */
export type ChunkMeta = {
	recording: string;
	/** 0, 1, 2, … in the order they were recorded. */
	seq: number;
	/** When that recording started, in ms since the epoch. */
	recordedAt: number;
	/** How much had been recorded by the end of this chunk, in ms, not counting pauses. */
	duration: number;
	/** What the recorder wrote, so a recovered recording gets its type. */
	type: string;
};

/** A saved recording, without its contents. */
export type SavedRecording = RecordingMeta & { id: string; size: number; type: string };

export type FinishResult = { ok: true; id: string } | { ok: false; error: string };

export const RECORDING_MESSAGES = {
	full: "The recording couldn't be saved: this device's storage is full or blocked. What was recorded is kept, and will be offered back next time.",
	empty: 'Nothing was recorded.'
} as const;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks a recording's `meta` (the recordings collection's `validate`). */
export function parseRecordingMeta(raw: unknown): RecordingMeta | undefined {
	if (!isObject(raw)) return undefined;
	const { name, recordedAt, duration, recovered } = raw;
	if (typeof name !== 'string' || !isCount(recordedAt) || !isCount(duration)) return undefined;
	if (recovered !== undefined && recovered !== true) return undefined;
	return { name, recordedAt, duration, ...(recovered ? { recovered } : {}) };
}

/** Checks a chunk's `meta`. */
export function parseChunkMeta(raw: unknown): ChunkMeta | undefined {
	if (!isObject(raw)) return undefined;
	const { recording, seq, recordedAt, duration, type } = raw;
	if (typeof recording !== 'string' || recording === '' || typeof type !== 'string')
		return undefined;
	if (!Number.isSafeInteger(seq) || (seq as number) < 0) return undefined;
	if (!isCount(recordedAt) || !isCount(duration)) return undefined;
	return { recording, seq: seq as number, recordedAt, duration, type };
}

export type RecordingCollectionOptions = {
	/** Default `recordings`; the chunks' collection is `<key>-chunks`. */
	key?: string;
	/** Default `Recordings`; the chunks' is `<label> (in progress)`. */
	label?: string;
	/** Default `recordings`. Clearing the group clears both. */
	group?: string;
};

/**
 * The options for a recordings collection and its chunks', to pass to `app.blobs.register`: both
 * personal (`sensitive`), in one group, out of backups.
 */
export function recordingCollections(options: RecordingCollectionOptions = {}) {
	const key = options.key ?? 'recordings';
	const label = options.label ?? 'Recordings';
	const group = options.group ?? 'recordings';
	const shared = { group, sensitive: true, backup: false } as const;
	return {
		recordings: { ...shared, key, label, validate: parseRecordingMeta },
		chunks: {
			...shared,
			key: `${key}-chunks`,
			label: `${label} (in progress)`,
			validate: parseChunkMeta
		}
	};
}

/** What the store uses of `navigator.locks`. */
export type LocksLike = {
	request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
	query(): Promise<{ held?: { name?: string }[] }>;
};

export type RecordingsEnv = {
	/** `navigator.locks` by default; `null` for none. */
	locks?: LocksLike | null;
	now?: () => number;
	/**
	 * Without locks: how long since a take's last chunk before `recover` takes it as abandoned, in
	 * ms. Default 10 minutes, longer than most pauses.
	 */
	staleAfter?: number;
};

/** Without the Locks API, takes with a chunk this recent may still be running elsewhere. */
export const STALE_AFTER = 10 * 60 * 1000;

/** What the store uses of `app.blobs`. */
export type BlobsLike = Pick<BlobScope, 'register' | 'put' | 'get' | 'list' | 'delete'>;

/** One recording being made: the chunks so far are saved under its id. */
export type Take = {
	readonly id: string;
	readonly recordedAt: number;
	/**
	 * Saves the next chunk, with how much had been recorded by its end. Chunks save one at a time,
	 * in order. False when it couldn't be saved (it's kept in memory and saved by `finish`).
	 */
	append(blob: Blob, duration: number): Promise<boolean>;
	/**
	 * Joins the chunks into one recording, then deletes them. When it can't be saved, the chunks
	 * stay, to be recovered next time.
	 */
	finish(name?: string): Promise<FinishResult>;
	/** Deletes what was recorded (a recording thrown away). */
	discard(): Promise<void>;
};

export type Recordings = {
	readonly collection: Collection<RecordingMeta>;
	readonly chunks: Collection<ChunkMeta>;
	/** Starts saving a new recording of `type` (what the recorder writes). */
	begin(type: string, recordedAt: number): Take;
	/**
	 * Joins the chunks of recordings that never finished (the app closed while recording) into
	 * recordings marked `recovered`, except `except` (a take still running in this tab). Returns
	 * the new recordings' ids.
	 */
	recover(except?: string[]): Promise<string[]>;
	/** Newest first. */
	list(): Promise<SavedRecording[]>;
	get(id: string): Promise<{ blob: Blob; recording: SavedRecording } | undefined>;
	delete(id: string): Promise<boolean>;
};

/** A random id for a take: chunks are grouped by it. */
function takeId(): string {
	const c = globalThis.crypto;
	if (typeof c?.randomUUID === 'function') return c.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const saved = (info: BlobInfo<RecordingMeta>): SavedRecording | undefined =>
	info.meta && { ...info.meta, id: info.id, size: info.size, type: info.type };

export function createRecordings(
	blobs: BlobsLike,
	options: RecordingCollectionOptions = {},
	env: RecordingsEnv = {}
): Recordings {
	const spec = recordingCollections(options);
	const collection = blobs.register<RecordingMeta>(spec.recordings);
	const chunks = blobs.register<ChunkMeta>(spec.chunks);
	const locks = (): LocksLike | undefined =>
		env.locks === null
			? undefined
			: (env.locks ??
				(globalThis as { navigator?: { locks?: LocksLike } }).navigator?.locks ??
				undefined);
	const now = env.now ?? Date.now;
	const staleAfter = env.staleAfter ?? STALE_AFTER;
	const lockName = (take: string) => `xcwds-recorder:${chunks.key}:${take}`;

	/**
	 * Holds `take`'s lock until the returned function is called, so other tabs' `recover` leaves
	 * it alone.
	 */
	function hold(take: string): () => void {
		const manager = locks();
		if (!manager) return () => {};
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		manager.request(lockName(take), () => held).catch(() => {});
		return release;
	}

	/** The takes whose lock some tab holds, or undefined when that can't be known. */
	async function heldTakes(): Promise<Set<string> | undefined> {
		const manager = locks();
		if (!manager) return undefined;
		try {
			const prefix = lockName('');
			const names = (await manager.query()).held?.map((l) => l.name ?? '') ?? [];
			return new Set(names.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length)));
		} catch {
			return undefined;
		}
	}

	/** The chunks saved for each take, in order. */
	async function savedChunks(): Promise<
		Map<string, (BlobInfo<ChunkMeta> & { meta: ChunkMeta })[]>
	> {
		const byTake = new Map<string, (BlobInfo<ChunkMeta> & { meta: ChunkMeta })[]>();
		for (const info of await blobs.list(chunks)) {
			if (!info.meta) continue;
			const list = byTake.get(info.meta.recording) ?? [];
			list.push(info as BlobInfo<ChunkMeta> & { meta: ChunkMeta });
			byTake.set(info.meta.recording, list);
		}
		for (const list of byTake.values()) list.sort((a, b) => a.meta.seq - b.meta.seq);
		return byTake;
	}

	/** Reads `ids`' chunks in order; undefined if one is missing. */
	async function read(ids: string[]): Promise<Blob[] | undefined> {
		const parts: Blob[] = [];
		for (const id of ids) {
			const got = await blobs.get(chunks, id);
			if (!got) return undefined;
			parts.push(got.blob);
		}
		return parts;
	}

	async function deleteAll(ids: string[]) {
		for (const id of ids) await blobs.delete(chunks, id);
	}

	function begin(type: string, recordedAt: number): Take {
		const id = takeId();
		const release = hold(id);
		/** Each chunk's saved id, or the blob itself when saving it failed. */
		const parts: (string | Blob)[] = [];
		let duration = 0;
		let queue: Promise<unknown> = Promise.resolve();
		let closed = false;

		const append = (blob: Blob, upTo: number): Promise<boolean> => {
			if (closed) return Promise.resolve(false);
			const seq = parts.length;
			// Hold the place now, so chunks keep their order whatever finishes first.
			parts.push(blob);
			duration = Math.max(duration, upTo);
			const meta: ChunkMeta = { recording: id, seq, recordedAt, duration: upTo, type };
			const run = queue.then(async () => {
				const saved = await blobs.put(chunks, blob, meta);
				if (saved === false) return false;
				parts[seq] = saved;
				return true;
			});
			queue = run.catch(() => {});
			return run;
		};

		return {
			id,
			recordedAt,
			append,
			async finish(name = '') {
				closed = true;
				try {
					return await save(name);
				} finally {
					release();
				}
			},
			async discard() {
				closed = true;
				try {
					await queue;
					await deleteAll(parts.filter((p): p is string => typeof p === 'string'));
				} finally {
					release();
				}
			}
		};

		async function save(name: string): Promise<FinishResult> {
			await queue;
			const ids = parts.filter((p): p is string => typeof p === 'string');
			// In order: saved chunks read back, and any that couldn't be saved from memory. One
			// that vanished meanwhile (its group cleared) is left out rather than losing the rest.
			const blobsInOrder: Blob[] = [];
			for (const p of parts) {
				if (typeof p !== 'string') blobsInOrder.push(p);
				else {
					const got = await blobs.get(chunks, p);
					if (got) blobsInOrder.push(got.blob);
				}
			}
			const audio = new Blob(blobsInOrder, { type });
			if (audio.size === 0) {
				await deleteAll(ids);
				return { ok: false, error: RECORDING_MESSAGES.empty };
			}
			const meta: RecordingMeta = { name, recordedAt, duration };
			const saved = await blobs.put(collection, audio, meta);
			if (saved === false) {
				// Save what's only in memory as chunks, so it can be recovered.
				for (const [seq, p] of parts.entries()) {
					if (typeof p === 'string') continue;
					await blobs.put(chunks, p, { recording: id, seq, recordedAt, duration, type });
				}
				return { ok: false, error: RECORDING_MESSAGES.full };
			}
			await deleteAll(ids);
			return { ok: true, id: saved };
		}
	}

	return {
		collection,
		chunks,
		begin,
		async recover(except = []) {
			const out: string[] = [];
			const held = await heldTakes();
			for (const [take, list] of await savedChunks()) {
				if (except.includes(take)) continue;
				// Still open in some tab (this one or another), or, without locks, maybe so.
				if (held ? held.has(take) : list.some((c) => now() - c.created < staleAfter)) continue;
				const ids = list.map((c) => c.id);
				const parts = await read(ids);
				if (!parts) continue;
				const first = list[0]!.meta;
				const audio = new Blob(parts, { type: first.type });
				if (audio.size === 0) {
					await deleteAll(ids);
					continue;
				}
				const meta: RecordingMeta = {
					name: '',
					recordedAt: first.recordedAt,
					duration: Math.max(...list.map((c) => c.meta.duration)),
					recovered: true
				};
				const saved = await blobs.put(collection, audio, meta);
				if (saved === false) continue;
				await deleteAll(ids);
				out.push(saved);
			}
			return out;
		},
		async list() {
			return (await blobs.list(collection))
				.map(saved)
				.filter((r): r is SavedRecording => r !== undefined);
		},
		async get(id) {
			const got = await blobs.get(collection, id);
			if (!got?.meta) return undefined;
			return {
				blob: got.blob,
				recording: { ...got.meta, id, size: got.blob.size, type: got.blob.type }
			};
		},
		delete: (id) => blobs.delete(collection, id)
	};
}
