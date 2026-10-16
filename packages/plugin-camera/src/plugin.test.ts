import { definePlugin, pluginMeta } from '@xcwds/core';
import { buildTestApp, type Importer } from '@xcwds/testing';
import { describe, expect, it, vi } from 'vitest';
import type { CameraEnv } from './camera.js';
import client, { SAVING, cameraPlugin } from './client.js';
import cameraFactory, { build } from './index.js';
import { resolveOptions } from './options.js';

const importer: Importer = async (id) => {
	const entries: Record<string, () => Promise<Record<string, unknown>>> = {
		'@xcwds/plugin-camera': () => import('./index.js'),
		'@xcwds/plugin-camera/client': () => import('./client.js')
	};
	const load = entries[id];
	if (!load) throw Object.assign(new Error(id), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
	return load();
};

/** A browser with one camera that always says yes; `tracks` are every track it handed out. */
function fakeEnv(photo?: Promise<Blob>) {
	const tracks: { readyState: string; stop: () => void }[] = [];
	const env: CameraEnv = {
		secure: true,
		media: {
			getUserMedia: vi.fn(async () => {
				const track = {
					kind: 'video',
					readyState: 'live',
					stop: vi.fn(() => void (track.readyState = 'ended')),
					getCapabilities: () => ({}),
					getSettings: () => ({ width: 1920, height: 1080 }),
					addEventListener: () => {}
				};
				tracks.push(track);
				return {
					getTracks: () => [track],
					getVideoTracks: () => [track]
				} as unknown as MediaStream;
			}),
			enumerateDevices: async () => []
		}
	};
	if (photo) {
		const takePhoto = () => photo;
		env.ImageCapture = class {
			takePhoto = takePhoto;
		};
	}
	return { env, tracks };
}

/** A stand-in for `@xcwds/plugin-lock`'s `app.lock`. */
function fakeLock() {
	const listeners = new Set<(state: { locked: boolean }) => void>();
	const lock = {
		state: { locked: false },
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

describe('options', () => {
	it('takes the camera options and refuses mistakes', async () => {
		expect(resolveOptions()).toEqual({});
		expect(
			resolveOptions({
				facing: 'user',
				type: 'image/webp',
				quality: 0.8,
				maxSide: 2048,
				maxDigitalZoom: 2
			})
		).toEqual({
			facing: 'user',
			type: 'image/webp',
			quality: 0.8,
			maxSide: 2048,
			maxDigitalZoom: 2
		});
		expect(() => resolveOptions({ facing: 'back' })).toThrow(/`facing`/);
		expect(() => resolveOptions({ type: 'image/png' })).toThrow(/`type`/);
		expect(() => resolveOptions({ quality: 2 })).toThrow(/`quality`/);
		expect(() => resolveOptions({ maxSide: 0 })).toThrow(/`maxSide`/);
		expect(() => resolveOptions({ maxSide: 10.5 })).toThrow(/`maxSide`/);
		expect(() => resolveOptions({ maxDigitalZoom: 0.5 })).toThrow(/`maxDigitalZoom`/);
		expect(() => resolveOptions({ video: true })).toThrow(/unknown option `video`/);
		expect(() => resolveOptions([])).toThrow(/must be an object/);
		expect(cameraFactory().name).toBe('@xcwds/plugin-camera');
		await expect(
			buildTestApp({ plugins: [cameraFactory({ facing: 'back' } as never)] }, { import: importer })
		).rejects.toThrow(/@xcwds\/plugin-camera: `facing`/);
	});

	it('loads from a config, makes no network requests, and gives the app `app.camera`', async () => {
		const app = await buildTestApp(
			{ plugins: [cameraFactory({ maxSide: 1024 })] },
			{ import: importer }
		);
		expect(app.camera?.state).toBe('idle');
		await app.close();
		expect(pluginMeta(build).network).toBe(false);
		expect(pluginMeta(client).network).toBe(false);
	});
});

describe('app.camera', () => {
	it('turns off while the page is hidden and back on when it returns', async () => {
		const { env, tracks } = fakeEnv();
		const app = await buildTestApp({ plugins: [[cameraPlugin(env), {}]] });
		const camera = app.camera!;
		expect(await camera.start()).toBe('live');

		await app.hooks.run('onHidden', []);
		expect(camera.state).toBe('idle');
		expect(tracks[0]!.readyState).toBe('ended');
		await app.hooks.run('onVisible', []);
		expect(camera.state).toBe('live');
		expect(tracks).toHaveLength(2);

		// Turned off by hand: coming back doesn't turn it on.
		camera.stop();
		await app.hooks.run('onHidden', []);
		await app.hooks.run('onVisible', []);
		expect(camera.state).toBe('idle');
		expect(tracks).toHaveLength(2);
		await app.close();
	});

	it('stops when the app locks, and stays off after unlocking', async () => {
		const { env, tracks } = fakeEnv();
		const lock = fakeLock();
		const app = await buildTestApp({
			plugins: [
				// After the camera in the list: found at boot, whatever the order.
				[cameraPlugin(env), {}],
				definePlugin((a) => void a.decorate('lock', lock as never), { encapsulate: false })
			]
		});
		const camera = app.camera!;
		await camera.start();
		lock.set(true);
		expect(camera.state).toBe('idle');
		expect(tracks[0]!.readyState).toBe('ended');
		lock.set(false);
		await app.hooks.run('onVisible', []);
		expect(camera.state).toBe('idle');

		// Locked while hidden (auto-lock): the return doesn't turn it on, even before the lock
		// gets to it.
		await camera.start();
		await app.hooks.run('onHidden', []);
		lock.state = { locked: true };
		await app.hooks.run('onVisible', []);
		expect(camera.state).toBe('idle');
		lock.state = { locked: false };
		await app.hooks.run('onVisible', []);
		expect(camera.state).toBe('idle');
		expect(tracks).toHaveLength(2);
		await app.close();
	});

	it('holds updates back only while a photo is being saved', async () => {
		let finish!: (blob: Blob) => void;
		const { env } = fakeEnv(new Promise<Blob>((resolve) => (finish = resolve)));
		env.createImageBitmap = async () => {
			throw new Error('no pixels');
		};
		const app = await buildTestApp({ plugins: [[cameraPlugin(env), {}]] });
		const camera = app.camera!;
		const reasons = () => app.hooks.collect('onBeforeReload', []);
		await camera.start();
		expect(await reasons()).toEqual([]);
		const saving = camera.capture();
		expect(camera.capturing).toBe(true);
		expect(await reasons()).toEqual([SAVING]);
		finish(new Blob(['x']));
		await saving;
		expect(await reasons()).toEqual([]);
		await app.close();
	});

	it('lets a photo finish before turning off for a hidden page', async () => {
		let finish!: (blob: Blob) => void;
		const { env, tracks } = fakeEnv(new Promise<Blob>((resolve) => (finish = resolve)));
		const sizes: [number, number][] = [];
		env.createImageBitmap = async () => {
			const width = 1920;
			const height = 1080;
			return { width, height, close() {} } as ImageBitmap;
		};
		vi.stubGlobal(
			'OffscreenCanvas',
			class {
				constructor(width: number, height: number) {
					sizes.push([width, height]);
				}
				getContext = () => ({ drawImage() {}, fillRect() {}, fillStyle: '' });
				convertToBlob = async () => new Blob(['jpeg'], { type: 'image/jpeg' });
			}
		);
		const app = await buildTestApp({ plugins: [[cameraPlugin(env), {}]] });
		const camera = app.camera!;
		await camera.start();
		await camera.setZoom(1.2);
		const saving = camera.capture();
		await app.hooks.run('onHidden', []);
		// Still on: the photo is being taken.
		expect(tracks[0]!.readyState).toBe('live');
		finish(new Blob(['still']));
		const result = await saving;
		expect(result.ok).toBe(true);
		// The 1.2× crop shown at the shutter.
		expect(sizes).toEqual([[1600, 900]]);
		expect(camera.state).toBe('idle');
		expect(tracks[0]!.readyState).toBe('ended');
		await app.hooks.run('onVisible', []);
		expect(camera.state).toBe('live');

		// Back before the photo is done: it stays on.
		let again!: (blob: Blob) => void;
		env.ImageCapture = class {
			takePhoto = () => new Promise<Blob>((resolve) => (again = resolve));
		};
		const next = camera.capture();
		await app.hooks.run('onHidden', []);
		await app.hooks.run('onVisible', []);
		again(new Blob(['still']));
		expect((await next).ok).toBe(true);
		expect(camera.state).toBe('live');
		await app.close();
		vi.unstubAllGlobals();
	});

	it('stops when the app closes', async () => {
		const { env, tracks } = fakeEnv();
		const app = await buildTestApp({ plugins: [[cameraPlugin(env), {}]] });
		await app.camera!.start();
		await app.close();
		expect(tracks[0]!.readyState).toBe('ended');
	});
});
