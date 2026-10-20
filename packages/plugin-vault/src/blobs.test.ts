import { createBlobs, memoryBlobs, type BlobRow } from '@xcwds/core';
import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES, SEALED_TYPE, SIZE_STEP, createBlobVault } from './blobs.js';
import { MIN_ITERATIONS, deriveKey, newSalt } from './seal.js';

const SECRET = 'a photo of the cycle tracker';
const CAPTION = 'day 12';

const key = (code = '123456') => deriveKey(code, newSalt(), MIN_ITERATIONS);

function setup(chunkBytes?: number) {
	const backend = memoryBlobs();
	const blobs = createBlobs({ backend });
	const scope = blobs.scope('camera');
	const photos = scope.register<{ caption: string }>({
		key: 'photos',
		label: 'Photos',
		sensitive: true
	});
	const icons = scope.register({ key: 'icons', label: 'Icons' });
	let on = false;
	const vault = createBlobVault({
		sensitive: () =>
			blobs
				.collections()
				.filter((c) => c.sensitive)
				.map((c) => c.key),
		enabled: () => on,
		...(chunkBytes ? { chunkBytes } : {})
	});
	blobs.layer(vault.layer);
	return {
		backend,
		blobs,
		photos,
		icons,
		vault,
		turnOn: () => (on = true),
		turnOff: () => (on = false)
	};
}

const text = async (blob: Blob) => new TextDecoder().decode(await blob.arrayBuffer());
/** Every byte the backend holds, and its rows' JSON, for scanning for plaintext. */
async function dump(backend: ReturnType<typeof memoryBlobs>) {
	let out = '';
	for (const row of backend.rows.values())
		out += JSON.stringify({ ...row, blob: undefined }) + (await text(row.blob));
	return out;
}
const rowOf = (backend: ReturnType<typeof memoryBlobs>, id: string) =>
	[...backend.rows.values()].find((r) => r.id === id)!;

async function sealedPhoto(chunkBytes?: number, content = SECRET) {
	const s = setup(chunkBytes);
	s.turnOn();
	const k = await key();
	s.vault.unlock(k);
	const id = await s.blobs.put(s.photos, new Blob([content], { type: 'image/jpeg' }), {
		caption: CAPTION
	});
	expect(id).not.toBe(false);
	return { ...s, k, id: id as string };
}

describe('the blob vault', () => {
	it('is a pass-through until it is turned on', async () => {
		const { blobs, backend, photos, vault } = setup();
		expect(vault.locked).toBe(false);
		const id = (await blobs.put(photos, new Blob([SECRET], { type: 'image/jpeg' }))) as string;
		expect(await text(rowOf(backend, id).blob)).toBe(SECRET);
		expect(await text((await blobs.get(photos, id))!.blob)).toBe(SECRET);
	});

	it('seals sensitive blobs and their meta, and opens them while unlocked', async () => {
		const { blobs, backend, photos, id } = await sealedPhoto();
		const stored = await dump(backend);
		expect(stored).not.toContain(SECRET);
		expect(stored).not.toContain(CAPTION);
		expect(stored).not.toContain('image/jpeg');
		const row = rowOf(backend, id);
		expect(row.type).toBe(SEALED_TYPE);
		expect(row.size).toBe(SIZE_STEP);

		const got = await blobs.get(photos, id);
		expect(await text(got!.blob)).toBe(SECRET);
		expect(got!.blob.type).toBe('image/jpeg');
		expect(got!.meta).toEqual({ caption: CAPTION });
		expect(await blobs.list(photos)).toEqual([
			expect.objectContaining({
				id,
				size: SECRET.length,
				type: 'image/jpeg',
				meta: { caption: CAPTION }
			})
		]);
	});

	it("leaves collections that aren't sensitive alone", async () => {
		const { blobs, backend, icons } = await sealedPhoto();
		const id = (await blobs.put(icons, new Blob(['icon'], { type: 'image/png' }))) as string;
		expect(await text(rowOf(backend, id).blob)).toBe('icon');
	});

	it('seals in chunks and opens them back in order', async () => {
		const content = 'x'.repeat(40) + SECRET + 'y'.repeat(30);
		const { blobs, backend, photos, id } = await sealedPhoto(16, content);
		// 98 bytes: 7 chunks of 16 (the last one short), each with its IV and tag.
		expect(rowOf(backend, id).blob.size).toBe(content.length + 7 * (12 + 16));
		expect(await dump(backend)).not.toContain(SECRET);
		expect(await text((await blobs.get(photos, id))!.blob)).toBe(content);
		// Empty blobs and blobs exactly a chunk long round-trip too.
		for (const c of ['', 'z'.repeat(16), 'z'.repeat(32)]) {
			const other = (await blobs.put(photos, new Blob([c]))) as string;
			expect(await text((await blobs.get(photos, other))!.blob)).toBe(c);
		}
	});

	it('uses megabyte chunks by default', () => {
		expect(CHUNK_BYTES).toBe(1024 * 1024);
	});

	describe('locked', () => {
		it("can't read, list or save a sensitive collection, but can delete and clear it", async () => {
			const { blobs, backend, photos, icons, vault, id } = await sealedPhoto();
			const plain = (await blobs.put(icons, new Blob(['icon']))) as string;
			vault.lock();
			expect(vault.locked).toBe(true);
			expect(await blobs.get(photos, id)).toBeUndefined();
			expect(await blobs.list(photos)).toEqual([]);
			expect(await blobs.put(photos, new Blob([SECRET]))).toBe(false);
			expect(await dump(backend)).not.toContain(SECRET);
			// Other collections still work.
			expect(await text((await blobs.get(icons, plain))!.blob)).toBe('icon');

			expect(await blobs.delete(photos, id)).toBe(true);
			expect(backend.rows.size).toBe(1);
			await blobs.put(icons, new Blob(['b']));
			expect(await blobs.clear(photos)).toBe(true);
		});

		it('serves plaintext left over in a sensitive collection only once unlocked', async () => {
			const s = setup();
			const id = (await s.blobs.put(s.photos, new Blob([SECRET]))) as string;
			s.turnOn();
			expect(await s.blobs.get(s.photos, id)).toBeUndefined();
			expect(await s.blobs.list(s.photos)).toEqual([]);
			s.vault.unlock(await key());
			expect(await text((await s.blobs.get(s.photos, id))!.blob)).toBe(SECRET);
		});

		it('keeps sealed blobs unreadable without the key once the vault is off', async () => {
			const { blobs, photos, vault, turnOff, id } = await sealedPhoto();
			vault.lock();
			turnOff();
			expect(vault.locked).toBe(false);
			expect(await blobs.get(photos, id)).toBeUndefined();
		});
	});

	describe("doesn't open", () => {
		it('with another key', async () => {
			const { blobs, photos, vault, id } = await sealedPhoto();
			vault.unlock(await key('654321'));
			expect(await blobs.get(photos, id)).toBeUndefined();
			expect(await blobs.list(photos)).toEqual([]);
		});

		async function tampered(change: (row: BlobRow, bytes: Uint8Array<ArrayBuffer>) => BlobRow) {
			const s = await sealedPhoto(16, 'x'.repeat(40) + SECRET);
			const row = rowOf(s.backend, s.id);
			const bytes = new Uint8Array(await row.blob.arrayBuffer());
			await s.backend.put(change(row, bytes));
			return s.blobs.get(s.photos, s.id);
		}

		it('changed data', async () => {
			expect(
				await tampered((row, b) => {
					b[30] = b[30]! ^ 1;
					return { ...row, blob: new Blob([b]) };
				})
			).toBeUndefined();
		});

		it('chunks reordered, dropped or added', async () => {
			const chunk = 12 + 16 + 16;
			expect(
				await tampered((row, b) => ({
					...row,
					blob: new Blob([
						b.subarray(chunk, 2 * chunk),
						b.subarray(0, chunk),
						b.subarray(2 * chunk)
					])
				}))
			).toBeUndefined();
			expect(
				await tampered((row, b) => ({ ...row, blob: new Blob([b.subarray(0, b.length - chunk)]) }))
			).toBeUndefined();
			expect(
				await tampered((row, b) => ({ ...row, blob: new Blob([b, b.subarray(0, chunk)]) }))
			).toBeUndefined();
		});

		it('moved to another id or collection', async () => {
			const s = await sealedPhoto();
			const row = rowOf(s.backend, s.id);
			await s.backend.put({ ...row, id: 'elsewhere' });
			expect(await s.blobs.get(s.photos, 'elsewhere')).toBeUndefined();
			const other = s.blobs
				.scope('camera')
				.register({ key: 'more', label: 'More', sensitive: true });
			await s.backend.put({ ...row, collection: other.key });
			expect(await s.blobs.get(other, s.id)).toBeUndefined();
		});
	});

	describe('turning on and off', () => {
		it('seals existing blobs, and opens them back', async () => {
			const s = setup(8);
			const ids: string[] = [];
			for (const n of [1, 2, 3])
				ids.push(
					(await s.blobs.put(s.photos, new Blob([`${SECRET} ${n}`]), {
						caption: CAPTION
					})) as string
				);
			const icon = (await s.blobs.put(s.icons, new Blob(['icon']))) as string;
			// Nothing to seal with until there's a key.
			expect(await s.vault.sealAll()).toBe(false);

			s.turnOn();
			s.vault.unlock(await key());
			const seen: [number, number][] = [];
			expect(await s.vault.sealAll((done, total) => seen.push([done, total]))).toBe(true);
			expect(seen).toEqual([
				[0, 3],
				[1, 3],
				[2, 3],
				[3, 3]
			]);
			expect(await dump(s.backend)).not.toContain(SECRET);
			expect(await text(rowOf(s.backend, icon).blob)).toBe('icon');
			// Again: nothing left to do.
			expect(await s.vault.sealAll((done, total) => seen.push([done, total]))).toBe(true);
			expect(seen.at(-1)).toEqual([0, 0]);
			for (const [i, id] of ids.entries()) {
				const got = await s.blobs.get(s.photos, id);
				expect(await text(got!.blob)).toBe(`${SECRET} ${i + 1}`);
				expect(got!.meta).toEqual({ caption: CAPTION });
			}

			expect(await s.vault.openAll()).toBe(true);
			s.turnOff();
			s.vault.lock();
			for (const [i, id] of ids.entries()) {
				expect(await text(rowOf(s.backend, id).blob)).toBe(`${SECRET} ${i + 1}`);
				expect(rowOf(s.backend, id).meta).toEqual({ caption: CAPTION });
			}
		});

		it("reports a blob it couldn't convert, and leaves it as it was", async () => {
			const s = await sealedPhoto();
			s.vault.unlock(await key('654321'));
			expect(await s.vault.openAll()).toBe(false);
			expect(rowOf(s.backend, s.id).type).toBe(SEALED_TYPE);
		});
	});

	it('refuses a chunk size that is not a whole number of bytes', () => {
		for (const chunkBytes of [0, 1.5, -1])
			expect(() =>
				createBlobVault({ sensitive: () => [], enabled: () => true, chunkBytes })
			).toThrow(/chunkBytes/);
	});
});
