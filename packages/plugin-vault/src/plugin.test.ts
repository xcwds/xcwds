import {
	definePlugin,
	memoryStorage,
	pluginMeta,
	type App,
	type BlobBackend,
	type Collection
} from '@xcwds/core';
import lock from '@xcwds/plugin-lock/client';
import { buildTestApp, sharedStorage, type TestApp } from '@xcwds/testing';
import { describe, expect, it, vi } from 'vitest';
import client from './client.js';
import { build } from './index.js';
import { resolveOptions } from './options.js';

const SECRET = 'cycle day 12';

type Diary = { read(): string | undefined; write(text: string): boolean };

/** A plugin with a sensitive note, and a plain one beside it. */
const diaryPlugin = definePlugin(
	(app) => {
		const note = app.storage.entry<string>('note', {
			label: 'Diary',
			parse: (v) => (typeof v === 'string' ? v : undefined),
			sensitive: true
		});
		app.decorate('diary', {
			read: () => app.storage.read(note),
			write: (text: string) => app.storage.write(note, text)
		} satisfies Diary);
	},
	{ name: 'diary', encapsulate: false }
);

const diary = (app: App) => (app as unknown as { diary: Diary }).diary;

/** A sensitive photo collection (#149), and a plain one beside it. */
const photosPlugin = definePlugin(
	(app) => {
		app.decorate('photos', {
			private: app.blobs.register({ key: 'private', label: 'Photos', sensitive: true }),
			plain: app.blobs.register({ key: 'plain', label: 'Stickers', group: 'stickers' })
		});
	},
	{ name: 'photos', encapsulate: false }
);
type Photos = { private: Collection; plain: Collection };
const photos = (app: App) => (app as unknown as { photos: Photos }).photos;

/** What the device's blob store holds, under every layer (installed before the vault's). */
let raw: BlobBackend;
const rawBlobs = definePlugin(
	(app) =>
		app.blobs.layer((below) => {
			raw = below;
			return below;
		}),
	{ name: 'raw', encapsulate: false }
);

function open(storage = sharedStorage(memoryStorage())) {
	return buildTestApp(
		{
			plugins: [
				[lock, {}],
				[rawBlobs, {}],
				[client, {}],
				[diaryPlugin, {}],
				[photosPlugin, {}]
			]
		},
		{ storage }
	);
}

const PHOTO = 'not really a jpeg, but private';
const photo = () => new Blob([PHOTO], { type: 'image/jpeg' });
/** Every blob's bytes on the device, as text. */
async function rawText(collection: Collection) {
	const rows = await raw.list(collection.key);
	return Promise.all(rows.map(async (r) => (await raw.get(collection.key, r.id))!.blob.text()));
}
const sealed = async (collection: Collection) =>
	(await raw.list(collection.key)).every(
		(r) => (r.meta as { vault?: number } | undefined)?.vault === 1
	);

/** Everything the device holds, for scanning for plaintext. */
const dump = (app: TestApp) =>
	[...(app.sharedStorage.backing as ReturnType<typeof memoryStorage>).data].flat().join('\n');

describe('the plugin', () => {
	it('takes no options, and needs the lock registered before it', async () => {
		expect(resolveOptions({})).toEqual({});
		expect(resolveOptions({ prefix: '/x' })).toEqual({});
		expect(() => resolveOptions({ passphrase: 'x' })).toThrow(/unknown option `passphrase`/);
		expect(() => resolveOptions([])).toThrow(/must be an object/);
		expect(pluginMeta(build)).toMatchObject({
			dependencies: ['@xcwds/plugin-lock'],
			network: false
		});
		expect(pluginMeta(client).network).toBe(false);
		await expect(buildTestApp({ plugins: [[client, {}]] })).rejects.toThrow(
			/needs "@xcwds\/plugin-lock"/
		);
	});

	it('seals sensitive data with the passcode, and opens it only once unlocked', async () => {
		const app = await open();
		expect(app.vault!.state).toEqual({ enabled: false, locked: false });
		diary(app).write(SECRET);
		expect(await app.lock!.setUp('123456', 'digits')).toBeUndefined();
		expect(app.vault!.state).toEqual({ enabled: true, locked: false });
		expect(diary(app).read()).toBe(SECRET);
		expect(diary(app).write('cycle day 13')).toBe(true);
		expect(await app.vault!.flush()).toBe(true);
		expect(dump(app)).not.toContain('cycle');

		app.lock!.lock();
		expect(app.vault!.state.locked).toBe(true);
		expect(diary(app).read()).toBeUndefined();
		expect(diary(app).write('nope')).toBe(false);
		expect(await app.lock!.unlock('000000')).toBe('wrong');
		expect(diary(app).read()).toBeUndefined();
		expect(await app.lock!.unlock('123456')).toBe('ok');
		expect(diary(app).read()).toBe('cycle day 13');

		// A new start is locked, and the passcode opens it.
		const next = await app.openTab();
		expect(next.lock!.state.locked).toBe(true);
		expect(next.vault!.state).toEqual({ enabled: true, locked: true });
		expect(diary(next).read()).toBeUndefined();
		expect(await next.lock!.unlock('123456')).toBe('ok');
		expect(diary(next).read()).toBe('cycle day 13');
		await app.close();
	});

	it('locks a tab whose key another tab replaced', async () => {
		const app = await open();
		expect(await app.lock!.setUp('123456', 'digits')).toBeUndefined();
		const other = await app.openTab();
		expect(await other.lock!.unlock('123456')).toBe('ok');
		expect(await other.lock!.change('123456', '654321', 'digits')).toBe('ok');
		await app.settle();
		// This tab's key can't open what the other one sealed: the app asks for the passcode.
		expect(app.lock!.state.locked).toBe(true);
		expect(app.vault!.state.locked).toBe(true);
		expect(await app.lock!.unlock('654321')).toBe('ok');
		diary(other).write(SECRET);
		await other.vault!.flush();
		await app.settle();
		// Opened again here, asynchronously.
		await vi.waitFor(() => expect(diary(app).read()).toBe(SECRET));
		await app.close();
	});

	it('writes the data back when the lock is turned off, and drops it on a reset', async () => {
		const app = await open();
		expect(await app.lock!.setUp('123456', 'digits')).toBeUndefined();
		diary(app).write(SECRET);
		expect(await app.lock!.turnOff('123456')).toBe('ok');
		expect(app.vault!.state).toEqual({ enabled: false, locked: false });
		expect(dump(app)).toContain(SECRET);

		expect(await app.lock!.setUp('123456', 'digits')).toBeUndefined();
		expect(dump(app)).not.toContain('cycle');
		app.lock!.lock();
		expect(app.lock!.reset().map((g) => g.label)).toEqual(['Diary', 'Photos']);
		expect(app.vault!.state).toEqual({ enabled: false, locked: false });
		expect(diary(app).read()).toBeUndefined();
		expect(dump(app)).not.toContain('sealed');
		await app.close();
	});

	it('holds an update until writes are sealed', async () => {
		const app = await open();
		expect(await app.lock!.setUp('123456', 'digits')).toBeUndefined();
		diary(app).write(SECRET);
		// Nothing to tell the person: the update just waits for the seal.
		expect(await app.hooks.collect('onBeforeReload', [])).toEqual([]);
		const next = await app.openTab();
		expect(await next.lock!.unlock('123456')).toBe('ok');
		expect(diary(next).read()).toBe(SECRET);
		await app.close();
	});

	describe('files (#149)', () => {
		it('seals files saved before the passcode, and opens them only once unlocked', async () => {
			const app = await open();
			const { private: mine, plain } = photos(app);
			const before = await app.blobs.put(mine, photo(), { caption: 'mine' });
			expect(await app.blobs.put(plain, photo())).toBeTypeOf('string');
			expect(await app.lock!.setUp('123456', 'digits')).toBeUndefined();
			await vi.waitFor(async () => expect(await sealed(mine)).toBe(true));
			expect(app.vault!.progress).toBeUndefined();
			// Saved now: sealed at once.
			const after = await app.blobs.put(mine, photo());
			expect(await sealed(mine)).toBe(true);
			for (const text of await rawText(mine)) expect(text).not.toContain('private');
			// Plain collections are left as they are.
			expect(await rawText(plain)).toEqual([PHOTO]);
			const got = await app.blobs.get(mine, before as string);
			expect(await got!.blob.text()).toBe(PHOTO);
			expect(got!.meta).toEqual({ caption: 'mine' });
			expect((await app.blobs.list(mine)).map((b) => b.type)).toEqual(['image/jpeg', 'image/jpeg']);

			app.lock!.lock();
			expect(await app.blobs.get(mine, after as string)).toBeUndefined();
			expect(await app.blobs.list(mine)).toEqual([]);
			expect(await app.blobs.put(mine, photo())).toBe(false);
			expect(await app.blobs.list(plain)).toHaveLength(1);

			// Another start opens them with the passcode.
			const next = await app.openTab();
			expect(await next.blobs.get(mine, after as string)).toBeUndefined();
			expect(await next.lock!.unlock('123456')).toBe('ok');
			expect(await (await next.blobs.get(mine, after as string))!.blob.text()).toBe(PHOTO);
			await app.close();
		});

		it('keeps files readable across a new passcode, without sealing them again', async () => {
			const app = await open();
			const { private: mine } = photos(app);
			expect(await app.lock!.setUp('123456', 'digits')).toBeUndefined();
			const id = (await app.blobs.put(mine, photo())) as string;
			const bytes = await rawText(mine);
			expect(await app.lock!.change('123456', '654321', 'digits')).toBe('ok');
			expect(await rawText(mine)).toEqual(bytes);
			const next = await app.openTab();
			expect(await next.lock!.unlock('654321')).toBe('ok');
			expect(await (await next.blobs.get(mine, id))!.blob.text()).toBe(PHOTO);
			await app.close();
		});

		it('opens files back when the lock is turned off, and clears them on a reset', async () => {
			const app = await open();
			const { private: mine } = photos(app);
			expect(await app.lock!.setUp('123456', 'digits')).toBeUndefined();
			const id = (await app.blobs.put(mine, photo())) as string;
			expect(await app.lock!.turnOff('123456')).toBe('ok');
			expect(await rawText(mine)).toEqual([PHOTO]);
			expect(await sealed(mine)).toBe(false);
			expect(await (await app.blobs.get(mine, id))!.blob.text()).toBe(PHOTO);
			// Saved while off: plaintext.
			await app.blobs.put(mine, photo());
			expect(await rawText(mine)).toEqual([PHOTO, PHOTO]);

			expect(await app.lock!.setUp('123456', 'digits')).toBeUndefined();
			await vi.waitFor(async () => expect(await sealed(mine)).toBe(true));
			app.lock!.lock();
			app.lock!.reset();
			await vi.waitFor(async () => expect(await raw.list(mine.key)).toEqual([]));
			await app.close();
		});
	});
});
