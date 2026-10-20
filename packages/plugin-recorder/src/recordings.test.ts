import { createBlobs, memoryBlobs } from '@xcwds/core';
import { describe, expect, it } from 'vitest';
import {
	RECORDING_MESSAGES,
	createRecordings,
	parseChunkMeta,
	parseRecordingMeta,
	recordingCollections
} from './recordings.js';

const TYPE = 'audio/webm;codecs=opus';

function setup(backend = memoryBlobs()) {
	const blobs = createBlobs({ backend });
	const recordings = createRecordings(blobs.scope('recorder'));
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
			const first = setup(backend);
			const crashed = first.recordings.begin(TYPE, 5000);
			await crashed.append(new Blob(['before ']), 3000);
			await crashed.append(new Blob(['the crash']), 6000);
			const running = first.recordings.begin(TYPE, 9000);
			await running.append(new Blob(['still going']), 3000);

			// The app opens again (same storage).
			const { recordings, blobs } = setup(backend);
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
