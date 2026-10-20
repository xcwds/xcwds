import { definePlugin, pluginMeta } from '@xcwds/core';
import { buildTestApp, type Importer } from '@xcwds/testing';
import { describe, expect, it, vi } from 'vitest';
import client, { RECORDING, recorderPlugin, type RecorderPluginEnv } from './client.js';
import recorderFactory, { build } from './index.js';
import { resolveOptions } from './options.js';
import { MESSAGES, type MediaRecorderLike } from './recorder.js';
import { STALE_AFTER } from './recordings.js';

const TYPE = 'audio/webm;codecs=opus';

const importer: Importer = async (id) => {
	const entries: Record<string, () => Promise<Record<string, unknown>>> = {
		'@xcwds/plugin-recorder': () => import('./index.js'),
		'@xcwds/plugin-recorder/client': () => import('./client.js')
	};
	const load = entries[id];
	if (!load) throw Object.assign(new Error(id), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
	return load();
};

/** Says "hello" into each chunk. */
class FakeRecorder implements MediaRecorderLike {
	static isTypeSupported = (type: string) => type === TYPE;
	mimeType: string;
	ondataavailable: ((event: { data: Blob }) => void) | null = null;
	onstop: (() => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	constructor(_stream: MediaStream, options?: { mimeType?: string }) {
		this.mimeType = options?.mimeType ?? TYPE;
	}
	start() {}
	pause() {}
	resume() {}
	stop() {
		queueMicrotask(() => {
			this.ondataavailable?.({ data: new Blob(['hello'], { type: this.mimeType }) });
			this.onstop?.();
		});
	}
}

/** A browser with a microphone that always says yes, and a wake lock that records its use. */
function fakeEnv(extra: Partial<RecorderPluginEnv> = {}) {
	const track = { stop: vi.fn(), onended: null };
	const sentinels: { released: boolean; release: () => Promise<void> }[] = [];
	let visible = true;
	const env: RecorderPluginEnv = {
		recorder: {
			secure: true,
			media: {
				getUserMedia: vi.fn(
					async () =>
						({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream
				)
			},
			MediaRecorder: FakeRecorder,
			AudioContext: null
		},
		recordings: { locks: null },
		wakeLock: {
			request: vi.fn(async () => {
				const sentinel = {
					released: false,
					listeners: [] as (() => void)[],
					async release() {
						sentinel.released = true;
						for (const l of sentinel.listeners) l();
					},
					addEventListener(_type: 'release', listener: () => void) {
						sentinel.listeners.push(listener);
					}
				};
				sentinels.push(sentinel);
				return sentinel;
			})
		},
		visible: () => visible,
		...extra
	};
	return {
		env,
		sentinels,
		held: () => sentinels.filter((s) => !s.released).length,
		hide: () => {
			visible = false;
			// The browser lets a wake lock go when the page is hidden.
			for (const s of sentinels) void s.release();
		},
		show: () => (visible = true)
	};
}

/** A stand-in for `@xcwds/plugin-lock`'s `app.lock`. */
function fakeLock(locked = false) {
	const listeners = new Set<(state: { locked: boolean }) => void>();
	const lock = {
		state: { locked },
		subscribe(listener: (state: { locked: boolean }) => void) {
			listeners.add(listener);
			listener(lock.state);
			return () => void listeners.delete(listener);
		},
		set(locked: boolean) {
			lock.state = { locked };
			for (const listener of listeners) listener(lock.state);
		}
	};
	return lock;
}

const lockPlugin = (lock: ReturnType<typeof fakeLock>) =>
	definePlugin((a) => void a.decorate('lock', lock as never), { encapsulate: false });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('options', () => {
	it('takes the voice processing switches and a timeslice, and refuses mistakes', async () => {
		expect(resolveOptions()).toEqual({});
		const all = {
			echoCancellation: false,
			noiseSuppression: false,
			autoGainControl: true,
			timeslice: 1000
		};
		expect(resolveOptions(all)).toEqual(all);
		expect(() => resolveOptions({ noiseSuppression: 'no' })).toThrow(/`noiseSuppression`/);
		expect(() => resolveOptions({ timeslice: 10 })).toThrow(/`timeslice`/);
		expect(() => resolveOptions({ timeslice: 1000.5 })).toThrow(/`timeslice`/);
		expect(() => resolveOptions({ timeslice: 120_000 })).toThrow(/`timeslice`/);
		expect(() => resolveOptions({ video: true })).toThrow(/unknown option `video`/);
		expect(() => resolveOptions(null)).toThrow(/must be an object/);
		expect(recorderFactory().name).toBe('@xcwds/plugin-recorder');
		await expect(
			buildTestApp({ plugins: [recorderFactory({ timeslice: 1 })] }, { import: importer })
		).rejects.toThrow(/@xcwds\/plugin-recorder: `timeslice`/);
	});

	it('loads from a config, makes no network requests, and gives the app `app.recorder`', async () => {
		const app = await buildTestApp(
			{ plugins: [recorderFactory({ noiseSuppression: false })] },
			{ import: importer }
		);
		expect(app.recorder?.state).toBe('idle');
		expect(app.recordings?.collection).toMatchObject({
			key: 'app:recorder:recordings',
			group: 'recordings',
			sensitive: true,
			backup: false
		});
		expect(await app.recordings?.recovered).toEqual([]);
		await app.close();
		expect(pluginMeta(build).network).toBe(false);
		expect(pluginMeta(client).network).toBe(false);
	});
});

describe('app.recorder', () => {
	it('records into `app.recordings`, and holds updates back until it is saved', async () => {
		const { env } = fakeEnv();
		const app = await buildTestApp({ plugins: [[recorderPlugin(env), {}]] });
		const recorder = app.recorder!;
		const reasons = () => app.hooks.collect('onBeforeReload', []);
		expect(await reasons()).toEqual([]);
		expect(await recorder.start()).toBe('recording');
		expect(await reasons()).toEqual([RECORDING]);
		recorder.pause();
		expect(await reasons()).toEqual([RECORDING]);
		const saving = recorder.stop('Note');
		expect(await reasons()).toEqual([RECORDING]);
		expect((await saving)?.ok).toBe(true);
		expect(await reasons()).toEqual([]);
		expect(await app.recordings!.list()).toMatchObject([{ name: 'Note', type: TYPE }]);
		await app.close();
	});

	it('keeps the screen on while recording, taking the lock again on return', async () => {
		const fake = fakeEnv();
		const app = await buildTestApp({ plugins: [[recorderPlugin(fake.env), {}]] });
		const recorder = app.recorder!;
		await recorder.start();
		await settle();
		expect(fake.held()).toBe(1);
		recorder.pause();
		await settle();
		expect(fake.held()).toBe(1);

		fake.hide();
		await app.hooks.run('onHidden', []);
		expect(fake.held()).toBe(0);
		fake.show();
		await app.hooks.run('onVisible', []);
		expect(fake.held()).toBe(1);
		expect(fake.sentinels).toHaveLength(2);

		await recorder.stop();
		await settle();
		expect(fake.held()).toBe(0);
		// Not recording: coming back takes no lock.
		await app.hooks.run('onVisible', []);
		expect(fake.sentinels).toHaveLength(2);
		await app.close();
	});

	it('records without a wake lock where there is none, or it is refused', async () => {
		for (const wakeLock of [
			null,
			{
				request: async () => {
					throw new Error('NotAllowedError');
				}
			}
		]) {
			const { env } = fakeEnv({ wakeLock });
			const app = await buildTestApp({ plugins: [[recorderPlugin(env), {}]] });
			expect(await app.recorder!.start()).toBe('recording');
			await settle();
			expect((await app.recorder!.stop())?.ok).toBe(true);
			await app.close();
		}
	});

	it('lets a wake lock go that arrives after recording stopped', async () => {
		let grant!: () => void;
		const fake = fakeEnv();
		const request = fake.env.wakeLock!.request;
		fake.env.wakeLock = {
			request: async (type) => {
				await new Promise<void>((resolve) => (grant = resolve));
				return request(type);
			}
		};
		const app = await buildTestApp({ plugins: [[recorderPlugin(fake.env), {}]] });
		await app.recorder!.start();
		await app.recorder!.stop();
		grant();
		await settle();
		await settle();
		expect(fake.sentinels).toHaveLength(1);
		expect(fake.held()).toBe(0);
		await app.close();
	});

	it('stops and saves the recording when the app closes', async () => {
		const fake = fakeEnv();
		const app = await buildTestApp({ plugins: [[recorderPlugin(fake.env), {}]] });
		const tab = await app.openTab();
		await app.recorder!.start();
		await settle();
		await app.close();
		expect(app.recorder!.state).toBe('idle');
		expect(fake.held()).toBe(0);
		expect(await tab.recordings!.list()).toHaveLength(1);
		await tab.close();
	});

	it('stops and saves when the app locks, and stays stopped after unlocking', async () => {
		const { env } = fakeEnv();
		const lock = fakeLock();
		const app = await buildTestApp({
			plugins: [
				// Before the lock in the list: found at boot, whatever the order.
				[recorderPlugin(env), {}],
				lockPlugin(lock)
			]
		});
		const recorder = app.recorder!;
		await recorder.start();
		lock.set(true);
		await settle();
		expect(recorder.state).toBe('idle');
		expect(recorder.notice).toBe(MESSAGES.locked);
		lock.set(false);
		await settle();
		expect(recorder.state).toBe('idle');
		expect(await app.recordings!.list()).toHaveLength(1);
		await app.close();
	});
});

describe('recovery', () => {
	/** A tab that closed mid-recording: its chunks are saved, the recording never finished. */
	async function crashed(env: RecorderPluginEnv, more: ReturnType<typeof lockPlugin>[] = []) {
		const app = await buildTestApp({ plugins: [[recorderPlugin(env), {}], ...more] });
		const take = app.recordings!.begin(TYPE, 5000);
		await take.append(new Blob(['before the crash']), 4000);
		return app;
	}
	const later = (fake: ReturnType<typeof fakeEnv>) => {
		fake.env.recordings = { locks: null, now: () => Date.now() + STALE_AFTER };
	};

	it('joins a recording left unfinished, on boot', async () => {
		const fake = fakeEnv();
		const first = await crashed(fake.env);
		later(fake);
		const app = await first.openTab();
		const [id] = await app.recordings!.recovered;
		const got = await app.recordings!.get(id!);
		expect(got?.recording).toMatchObject({ recovered: true, recordedAt: 5000, duration: 4000 });
		expect(await got!.blob.text()).toBe('before the crash');
		await app.close();
		await first.close();
	});

	it("doesn't join one twice when asked to recover twice at once", async () => {
		const fake = fakeEnv();
		later(fake);
		const app = await buildTestApp({ plugins: [[recorderPlugin(fake.env), {}]] });
		expect(await app.recordings!.recovered).toEqual([]);
		await app.recordings!.begin(TYPE, 0).append(new Blob(['once']), 1000);
		const runs = await Promise.all([app.recordings!.recover(), app.recordings!.recover()]);
		expect(runs.flat()).toHaveLength(1);
		expect(await app.recordings!.list()).toHaveLength(1);
		await app.close();
	});

	it('waits until the app is unlocked, and runs again on each unlock', async () => {
		const fake = fakeEnv();
		const lock = fakeLock(true);
		const first = await crashed(fake.env, [lockPlugin(lock)]);
		later(fake);
		const app = await first.openTab();
		let recovered: string[] | undefined;
		void app.recordings!.recovered.then((ids) => (recovered = ids));
		await settle();
		expect(recovered).toBeUndefined();
		expect(await app.recordings!.list()).toEqual([]);
		lock.set(false);
		await vi.waitFor(() => expect(recovered).toHaveLength(1));

		// Another one left behind (say it couldn't be saved while locked): the next unlock joins it.
		lock.set(true);
		await app.recordings!.begin(TYPE, 9000).append(new Blob(['again']), 1000);
		lock.set(false);
		await vi.waitFor(async () => expect(await app.recordings!.list()).toHaveLength(2));
		await app.close();
		await first.close();
	});
});
