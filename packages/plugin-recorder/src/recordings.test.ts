import { createBlobs, memoryBlobs } from '@xcwds/core';
import { describe, expect, it, vi } from 'vitest';
import {
	RECORDING_MESSAGES,
	STALE_AFTER,
	createRecordings,
	type LocksLike,
	type RecordingsEnv,
	parseChunkMeta,
	parseRecordingMeta,
	recordingCollections
} from './recordings.js';

const TYPE = 'audio/webm;codecs=opus';

/** `navigator.locks` for one browser: the tabs (stores) made with it share its locks. */
class FakeLocks implements LocksLike {
	held = new Set<string>();
	async request(
		name: string,
		options: { ifAvailable?: boolean },
		callback: (lock: unknown) => Promise<unknown>
	) {
		// Only `ifAvailable` is needed here: no test waits for a lock.
		if (this.held.has(name)) {
			if (options.ifAvailable) return callback(null);
			throw new Error(`${name} is held: the fake can't wait for it`);
		}
		this.held.add(name);
		try {
			return await callback({ name });
		} finally {
			this.held.delete(name);
		}
	}
	async query() {
		return { held: [...this.held].map((name) => ({ name })) };
	}
}

function setup(backend = memoryBlobs(), env: RecordingsEnv = { locks: new FakeLocks() }) {
	const blobs = createBlobs({ backend });
	const recordings = createRecordings(blobs.scope('recorder'), {}, env);
	return { backend, blobs, recordings };
}

const text = async (blob: Blob) => new TextDecoder().decode(await blob.arrayBuffer());

describe('recordings', () => {
	it('are personal, grouped together and out of backups', () => {
		const { recordings } = setup();
		for (const c of [recordings.collection, recordings.chunks]) {
			expect(c).toMatchObject({ group: 'recordings', sensitive: true, backup: false });
		}
		expect(recordings.collection.key).toBe('app:recorder:recordings');
		expect(recordings.chunks.key).toBe('app:recorder:recordings-chunks');
		expect(recordingCollections({ key: 'memos', label: 'Memos' }).chunks).toMatchObject({
			key: 'memos-chunks',
			label: 'Memos (in progress)'
		});
	});

	it('save each chunk as it arrives, then join them into one recording', async () => {
		const { recordings, blobs } = setup();
		const take = recordings.begin(TYPE, 1000);
		expect(await take.append(new Blob(['one ']), 3000)).toBe(true);
		expect(await take.append(new Blob(['two ']), 6000)).toBe(true);
		expect(await blobs.list(recordings.chunks)).toHaveLength(2);
		void take.append(new Blob(['three']), 7500);

		const result = await take.finish('Shopping list');
		expect(result.ok).toBe(true);
		expect(await blobs.list(recordings.chunks)).toEqual([]);
		const [saved] = await recordings.list();
		expect(saved).toMatchObject({
			name: 'Shopping list',
			recordedAt: 1000,
			duration: 7500,
			type: TYPE,
			size: 'one two three'.length
		});
		const got = await recordings.get(saved!.id);
		expect(await text(got!.blob)).toBe('one two three');
		expect(await recordings.delete(saved!.id)).toBe(true);
		expect(await recordings.list()).toEqual([]);
	});

	it('are listed newest recorded first, renamed, restored, and say when they change', async () => {
		const { recordings } = setup();
		const changes = vi.fn();
		const stop = recordings.onChange(changes);
		const save = async (at: number, words: string) => {
			const take = recordings.begin(TYPE, at);
			await take.append(new Blob([words]), 1000);
			const result = await take.finish();
			if (!result.ok) throw new Error(result.error);
			return result.id;
		};
		const older = await save(1000, 'older');
		await save(5000, 'newer');
		expect(changes).toHaveBeenCalledTimes(2);

		// Renaming saves it again: it keeps its place, by when it was recorded.
		const renamed = await recordings.rename(older, 'Older');
		expect(renamed).not.toBe(false);
		expect((await recordings.list()).map((r) => [r.name, r.recordedAt])).toEqual([
			['', 5000],
			['Older', 1000]
		]);
		expect(await recordings.get(older)).toBeUndefined();
		expect(await recordings.rename(older, 'gone')).toBe(false);

		const got = (await recordings.get(renamed as string))!;
		expect(await recordings.delete(got.recording.id)).toBe(true);
		const back = await recordings.restore(got.blob, {
			name: 'Older',
			recordedAt: 1000,
			duration: 1000
		});
		expect(await text((await recordings.get(back as string))!.blob)).toBe('older');
		expect(changes).toHaveBeenCalledTimes(5);
		stop();
		await recordings.delete(back as string);
		expect(changes).toHaveBeenCalledTimes(5);
	});

	it('keep chunks in order whichever saves first', async () => {
		const { recordings } = setup();
		const take = recordings.begin(TYPE, 0);
		const writes = ['a', 'b', 'c', 'd'].map((s, i) => take.append(new Blob([s]), i * 1000));
		await Promise.all(writes);
		const result = await take.finish();
		if (!result.ok) throw new Error(result.error);
		expect(await text((await recordings.get(result.id))!.blob)).toBe('abcd');
	});

	it('save nothing for an empty recording', async () => {
		const { recordings, blobs } = setup();
		const take = recordings.begin(TYPE, 0);
		await take.append(new Blob([]), 10);
		expect(await take.finish()).toEqual({ ok: false, error: RECORDING_MESSAGES.empty });
		expect(await blobs.list(recordings.collection)).toEqual([]);
		expect(await blobs.list(recordings.chunks)).toEqual([]);
	});

	it('throw a discarded recording away', async () => {
		const { recordings, blobs } = setup();
		const take = recordings.begin(TYPE, 0);
		await take.append(new Blob(['secret']), 1000);
		await take.discard();
		expect(await blobs.list(recordings.chunks)).toEqual([]);
		expect(await take.append(new Blob(['late']), 2000)).toBe(false);
		expect(await recordings.list()).toEqual([]);
	});

	it("keep the chunks when the recording can't be saved, for recovery", async () => {
		const backend = memoryBlobs();
		const { recordings, blobs } = setup(backend);
		const take = recordings.begin(TYPE, 0);
		await take.append(new Blob(['kept']), 1000);
		// The disk fills up: whole recordings no longer fit.
		const put = backend.put.bind(backend);
		backend.put = async (row) => {
			if (row.collection === recordings.collection.key) throw new Error('QuotaExceededError');
			return put(row);
		};
		expect(await take.finish()).toEqual({ ok: false, error: RECORDING_MESSAGES.full });
		expect(await blobs.list(recordings.chunks)).toHaveLength(1);

		backend.put = put;
		const [id] = await recordings.recover();
		expect(await text((await recordings.get(id!))!.blob)).toBe('kept');
	});

	it('keep a chunk that failed to save in memory, and save it with the rest', async () => {
		const backend = memoryBlobs();
		const { recordings } = setup(backend);
		const put = backend.put.bind(backend);
		let fail = true;
		backend.put = async (row) => {
			if (fail && row.collection === recordings.chunks.key) {
				fail = false;
				throw new Error('blocked');
			}
			return put(row);
		};
		const take = recordings.begin(TYPE, 0);
		expect(await take.append(new Blob(['first ']), 1000)).toBe(false);
		expect(await take.append(new Blob(['second']), 2000)).toBe(true);
		const result = await take.finish();
		if (!result.ok) throw new Error(result.error);
		expect(await text((await recordings.get(result.id))!.blob)).toBe('first second');
	});

	describe('recover', () => {
		it('joins the chunks of recordings that never finished', async () => {
			const backend = memoryBlobs();
			const first = setup(backend, { locks: null, now: () => Date.now() + STALE_AFTER });
			const crashed = first.recordings.begin(TYPE, 5000);
			await crashed.append(new Blob(['before ']), 3000);
			await crashed.append(new Blob(['the crash']), 6000);
			const running = first.recordings.begin(TYPE, 9000);
			await running.append(new Blob(['still going']), 3000);

			// The app opens again (same storage), long after.
			const { recordings, blobs } = setup(backend, {
				locks: null,
				now: () => Date.now() + STALE_AFTER
			});
			const ids = await recordings.recover([running.id]);
			expect(ids).toHaveLength(1);
			const got = await recordings.get(ids[0]!);
			expect(await text(got!.blob)).toBe('before the crash');
			expect(got!.recording).toMatchObject({
				name: '',
				recordedAt: 5000,
				duration: 6000,
				recovered: true,
				type: TYPE
			});
			// The running take's chunks are left alone.
			expect((await blobs.list(recordings.chunks)).map((c) => c.meta?.recording)).toEqual([
				running.id
			]);
			expect(await recordings.recover([running.id])).toEqual([]);
		});

		it('leaves a recording running in another tab alone', async () => {
			const backend = memoryBlobs();
			const locks = new FakeLocks();
			const first = setup(backend, { locks });
			const take = first.recordings.begin(TYPE, 0);
			await take.append(new Blob(['first tab ']), 3000);

			// A second tab opens while the first is recording (even paused, writing nothing).
			const second = setup(backend, { locks });
			expect(await second.recordings.recover()).toEqual([]);
			await take.append(new Blob(['still recording']), 6000);
			const result = await take.finish();
			if (!result.ok) throw new Error(result.error);
			expect(await text((await first.recordings.get(result.id))!.blob)).toBe(
				'first tab still recording'
			);
			expect(locks.held.size).toBe(0);
		});

		it('takes over one whose tab closed (its lock let go)', async () => {
			const backend = memoryBlobs();
			const locks = new FakeLocks();
			const first = setup(backend, { locks });
			const take = first.recordings.begin(TYPE, 0);
			await take.append(new Blob(['closed mid-sentence']), 3000);
			// The tab is killed: the browser lets its locks go, and `finish` never runs.
			locks.held.clear();
			const second = setup(backend, { locks });
			const [id] = await second.recordings.recover();
			expect(await text((await second.recordings.get(id!))!.blob)).toBe('closed mid-sentence');
		});

		it('joins one only once when two tabs recover it together', async () => {
			const backend = memoryBlobs();
			const locks = new FakeLocks();
			const first = setup(backend, { locks });
			await first.recordings.begin(TYPE, 0).append(new Blob(['once']), 3000);
			locks.held.clear();
			const a = setup(backend, { locks });
			const b = setup(backend, { locks });
			const [x, y] = await Promise.all([a.recordings.recover(), b.recordings.recover()]);
			expect([...x, ...y]).toHaveLength(1);
			expect(await a.recordings.list()).toHaveLength(1);
			expect(await a.blobs.list(a.recordings.chunks)).toEqual([]);
		});

		it('leaves alone a take that started after it looked', async () => {
			const backend = memoryBlobs();
			const locks = new FakeLocks();
			const { recordings } = setup(backend, { locks });
			// The take's chunk is saved, but the lock query ran before it began.
			const query = locks.query.bind(locks);
			let take: ReturnType<typeof recordings.begin> | undefined;
			locks.query = async () => {
				const before = await query();
				take = recordings.begin(TYPE, 0);
				await take.append(new Blob(['new']), 3000);
				return before;
			};
			expect(await recordings.recover()).toEqual([]);
			expect((await take!.finish()).ok).toBe(true);
		});

		it('without locks, leaves recently written recordings alone', async () => {
			const backend = memoryBlobs();
			let clock = Date.now();
			const env = { locks: null, now: () => clock };
			const first = setup(backend, env);
			await first.recordings.begin(TYPE, 0).append(new Blob(['maybe still going']), 3000);
			const second = setup(backend, env);
			expect(await second.recordings.recover()).toEqual([]);
			clock += STALE_AFTER + 1;
			expect(await second.recordings.recover()).toHaveLength(1);
		});

		it("falls back to the age of the chunks when locks can't be queried", async () => {
			const backend = memoryBlobs();
			const locks = new FakeLocks();
			locks.query = async () => {
				throw new Error('SecurityError');
			};
			const first = setup(backend, { locks });
			await first.recordings.begin(TYPE, 0).append(new Blob(['recent']), 3000);
			locks.held.clear();
			expect(await setup(backend, { locks }).recordings.recover()).toEqual([]);
		});
	});
});

describe('meta', () => {
	it('checks recordings and chunks', () => {
		expect(parseRecordingMeta({ name: 'a', recordedAt: 1, duration: 2 })).toEqual({
			name: 'a',
			recordedAt: 1,
			duration: 2
		});
		expect(parseRecordingMeta({ name: 'a', recordedAt: 1, duration: 2, recovered: true })).toEqual({
			name: 'a',
			recordedAt: 1,
			duration: 2,
			recovered: true
		});
		expect(parseRecordingMeta({ name: 1, recordedAt: 1, duration: 2 })).toBeUndefined();
		expect(parseRecordingMeta({ name: 'a', recordedAt: -1, duration: 2 })).toBeUndefined();
		const chunk = { recording: 'r', seq: 0, recordedAt: 1, duration: 2, type: TYPE };
		expect(parseChunkMeta(chunk)).toEqual(chunk);
		expect(parseChunkMeta({ ...chunk, seq: 1.5 })).toBeUndefined();
		expect(parseChunkMeta({ ...chunk, recording: '' })).toBeUndefined();
		expect(parseChunkMeta(null)).toBeUndefined();
	});
});
