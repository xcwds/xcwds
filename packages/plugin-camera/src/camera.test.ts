import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	MESSAGES,
	centreCrop,
	createCamera,
	digitalZoomLimit,
	zoomCrop,
	type CameraEnv
} from './camera.js';

/** A stand-in video track: `caps` are what `getCapabilities()` reports. */
function fakeTrack(caps: Record<string, unknown> = {}, settings = { width: 1920, height: 1080 }) {
	const listeners: Record<string, (() => void)[]> = {};
	const track = {
		kind: 'video',
		readyState: 'live' as 'live' | 'ended',
		stop: vi.fn(() => void (track.readyState = 'ended')),
		getCapabilities: () => caps,
		getSettings: () => settings,
		applyConstraints: vi.fn(async () => {}),
		addEventListener: (name: string, fn: () => void) => (listeners[name] ??= []).push(fn),
		end: () => listeners.ended?.forEach((fn) => fn())
	};
	return track;
}
type FakeTrack = ReturnType<typeof fakeTrack>;

const streamOf = (track: FakeTrack) =>
	({ getTracks: () => [track], getVideoTracks: () => [track] }) as unknown as MediaStream;

/** A browser stand-in. `answer` decides each getUserMedia call: a track, or an error name. */
function fakeEnv(
	answer: () => FakeTrack | string | Promise<FakeTrack | string> = () => fakeTrack()
) {
	const asked: MediaStreamConstraints[] = [];
	const env: CameraEnv & { asked: typeof asked } = {
		asked,
		secure: true,
		media: {
			getUserMedia: vi.fn(async (constraints?: MediaStreamConstraints) => {
				asked.push(constraints!);
				const a = await answer();
				if (typeof a === 'string') throw new DOMException('no', a);
				return streamOf(a);
			}),
			enumerateDevices: async () =>
				[
					{ kind: 'videoinput' },
					{ kind: 'audioinput' },
					{ kind: 'videoinput' }
				] as MediaDeviceInfo[]
		},
		now: () => 1_000
	};
	return env;
}

describe('digital zoom', () => {
	it('keeps the crop above 1 megapixel, under the cap', () => {
		expect(digitalZoomLimit(1920, 1080)).toBe(1.4);
		expect(digitalZoomLimit(4032, 3024)).toBe(3.4);
		expect(digitalZoomLimit(8000, 6000)).toBe(4);
		expect(digitalZoomLimit(8000, 6000, 2)).toBe(2);
		expect(digitalZoomLimit(640, 480)).toBe(1);
		expect(digitalZoomLimit(0, 0)).toBe(1);
	});

	it("crops a still to the viewfinder's shape before zooming", () => {
		// A 4:3 still behind a 16:9 viewfinder at 2×: 2000×1125 from the middle, not 2000×1500.
		expect(zoomCrop(4000, 3000, 16 / 9, 2)).toEqual({ x: 1000, y: 938, width: 2000, height: 1125 });
		// A frame already the viewfinder's shape is just zoomed.
		expect(zoomCrop(4000, 3000, 4 / 3, 2)).toEqual({ x: 1000, y: 750, width: 2000, height: 1500 });
		// A taller still behind a wide viewfinder, and a missing shape.
		expect(zoomCrop(3000, 4000, 16 / 9, 1)).toEqual({ x: 0, y: 1156, width: 3000, height: 1688 });
		expect(zoomCrop(4000, 3000, Number.NaN, 2)).toEqual({
			x: 1000,
			y: 750,
			width: 2000,
			height: 1500
		});
	});

	it('crops the centre of the frame', () => {
		expect(centreCrop(4000, 3000, 2)).toEqual({ x: 1000, y: 750, width: 2000, height: 1500 });
		expect(centreCrop(4000, 3000, 1)).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
	});
});

describe('createCamera', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('asks only when started, goes live, and stops every track', async () => {
		const track = fakeTrack();
		const env = fakeEnv(() => track);
		const camera = createCamera({}, env);
		const seen: string[] = [];
		camera.onChange(() => seen.push(camera.state));
		expect(env.media!.getUserMedia).not.toHaveBeenCalled();
		expect(await camera.start()).toBe('live');
		expect(seen).toEqual(['asking', 'live']);
		expect(env.asked[0]).toMatchObject({
			audio: false,
			video: { facingMode: { ideal: 'environment' } }
		});
		expect(camera.stream).not.toBeNull();
		camera.stop();
		expect(camera.state).toBe('idle');
		expect(camera.stream).toBeNull();
		expect(track.stop).toHaveBeenCalled();
	});

	it.each([
		['NotAllowedError', 'denied', MESSAGES.denied],
		['SecurityError', 'denied', MESSAGES.denied],
		['NotFoundError', 'unavailable', MESSAGES.notFound],
		['OverconstrainedError', 'unavailable', MESSAGES.notFound],
		['NotReadableError', 'error', MESSAGES.busy],
		['TypeError', 'error', MESSAGES.failed]
	])('reports %s as %s, in plain words', async (name, state, message) => {
		const camera = createCamera(
			{},
			fakeEnv(() => name)
		);
		expect(await camera.start()).toBe(state);
		expect(camera.error).toBe(message);
	});

	it("says why it can't start on an insecure page or without camera support", async () => {
		const insecure = createCamera({}, { ...fakeEnv(), secure: false });
		expect(await insecure.start()).toBe('unavailable');
		expect(insecure.error).toBe(MESSAGES.insecure);
		const none = createCamera({}, { secure: true, media: {} as CameraEnv['media'] });
		expect(await none.start()).toBe('unavailable');
		expect(none.error).toBe(MESSAGES.unsupported);
	});

	it('drops a stream that arrives after stop()', async () => {
		const track = fakeTrack();
		let grant!: (t: FakeTrack) => void;
		const camera = createCamera(
			{},
			fakeEnv(() => new Promise((r) => (grant = r)))
		);
		const started = camera.start();
		expect(camera.state).toBe('asking');
		camera.stop();
		grant(track);
		expect(await started).toBe('idle');
		expect(track.stop).toHaveBeenCalled();
		expect(camera.stream).toBeNull();
	});

	it('says so when the system turns the camera off', async () => {
		const track = fakeTrack();
		const camera = createCamera(
			{},
			fakeEnv(() => track)
		);
		await camera.start();
		track.end();
		expect(camera.state).toBe('error');
		expect(camera.error).toBe(MESSAGES.ended);
	});

	it('suspends and resumes only a camera that was on', async () => {
		const tracks: FakeTrack[] = [];
		const env = fakeEnv(() => {
			tracks.push(fakeTrack());
			return tracks.at(-1)!;
		});
		const camera = createCamera({ facing: 'user' }, env);
		expect(await camera.resume()).toBe('idle');
		await camera.start();
		camera.suspend();
		expect(camera.state).toBe('idle');
		expect(tracks[0]!.readyState).toBe('ended');
		expect(await camera.resume()).toBe('live');
		expect(env.asked[1]).toMatchObject({ video: { facingMode: { ideal: 'user' } } });
		// A camera turned off on purpose stays off.
		camera.stop();
		expect(await camera.resume()).toBe('idle');
		expect(env.asked).toHaveLength(2);
	});

	it('switches between the front and back cameras, and counts them', async () => {
		const env = fakeEnv();
		const camera = createCamera({}, env);
		await camera.start();
		await camera.switchFacing();
		expect(camera.facing).toBe('user');
		expect(env.asked[1]).toMatchObject({ video: { facingMode: { ideal: 'user' } } });
		expect(await camera.cameras()).toBe(2);
	});

	it("uses the camera's zoom and torch when it has them", async () => {
		const track = fakeTrack({ zoom: { min: 1, max: 10, step: 0.5 }, torch: true });
		const camera = createCamera(
			{},
			fakeEnv(() => track)
		);
		expect(camera.capabilities()).toEqual({ zoom: null, torch: false, torchOn: false });
		await camera.start();
		expect(camera.capabilities().zoom).toMatchObject({ kind: 'hardware', min: 1, max: 10 });
		await camera.setZoom(40);
		expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 10 }] });
		expect(camera.capabilities().zoom?.value).toBe(10);
		// A zoom the camera refuses isn't reported as applied.
		track.applyConstraints.mockRejectedValueOnce(new DOMException('no', 'OverconstrainedError'));
		await camera.setZoom(2);
		expect(camera.capabilities().zoom?.value).toBe(10);
		await camera.setTorch(true);
		expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: true }] });
		expect(camera.capabilities()).toMatchObject({ torch: true, torchOn: true });
	});

	it('offers digital zoom without hardware zoom, capped so the crop stays usable', async () => {
		const camera = createCamera(
			{ maxDigitalZoom: 3 },
			fakeEnv(() => fakeTrack({}, { width: 4032, height: 3024 }))
		);
		await camera.start();
		expect(camera.capabilities().zoom).toEqual({
			kind: 'digital',
			min: 1,
			max: 3,
			step: 0.1,
			value: 1
		});
		await camera.setZoom(5);
		expect(camera.capabilities().zoom?.value).toBe(3);
		// A stream too small to crop has no zoom at all.
		const small = createCamera(
			{},
			fakeEnv(() => fakeTrack({}, { width: 640, height: 480 }))
		);
		await small.start();
		expect(small.capabilities().zoom).toBeNull();
	});

	describe('capture', () => {
		/** Canvas and bitmap stand-ins: records what's drawn, writes a 4-byte JPEG. */
		function stubCanvas() {
			const drawn: unknown[][] = [];
			class Canvas {
				constructor(
					public width: number,
					public height: number
				) {}
				getContext() {
					return {
						fillStyle: '',
						fillRect: () => {},
						drawImage: (...args: unknown[]) => drawn.push(args.slice(1))
					};
				}
				async convertToBlob({ type }: { type: string }) {
					return new Blob([new Uint8Array([1, 2, 3, 4])], { type });
				}
			}
			vi.stubGlobal('OffscreenCanvas', Canvas);
			return drawn;
		}
		const bitmapOf = (width: number, height: number) => ({ width, height, close: vi.fn() });
		const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;

		it('takes a full-resolution still where ImageCapture works', async () => {
			const drawn = stubCanvas();
			const still = bitmapOf(4000, 3000);
			const env = fakeEnv();
			env.ImageCapture = class {
				async takePhoto() {
					return new Blob(['still']);
				}
			};
			env.createImageBitmap = vi.fn(async () => still as unknown as ImageBitmap);
			const camera = createCamera({ maxSide: 2000 }, env);
			await camera.start();
			const result = await camera.capture(video);
			expect(result).toEqual({
				ok: true,
				photo: {
					blob: expect.any(Blob),
					width: 2000,
					height: 1500,
					type: 'image/jpeg',
					takenAt: 1_000
				}
			});
			expect(env.createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), {
				imageOrientation: 'from-image'
			});
			expect(drawn).toEqual([[0, 0, 2000, 1500]]);
			expect(still.close).toHaveBeenCalled();
			expect(camera.capturing).toBe(false);
		});

		it('falls back to the viewfinder frame without ImageCapture, or when it fails', async () => {
			stubCanvas();
			const frame = bitmapOf(1920, 1080);
			const env = fakeEnv();
			env.createImageBitmap = vi.fn(async () => frame as unknown as ImageBitmap);
			const camera = createCamera({}, env);
			await camera.start();
			expect(await camera.capture(video)).toMatchObject({ ok: true, photo: { width: 1920 } });
			expect(env.createImageBitmap).toHaveBeenCalledWith(video, undefined);

			env.ImageCapture = class {
				async takePhoto(): Promise<Blob> {
					throw new DOMException('no', 'NotSupportedError');
				}
			};
			expect(await camera.capture(video)).toMatchObject({ ok: true, photo: { width: 1920 } });
		});

		it('crops a digitally zoomed photo to what the viewfinder showed', async () => {
			const drawn = stubCanvas();
			const env = fakeEnv(() => fakeTrack({}, { width: 4000, height: 3000 }));
			env.createImageBitmap = vi.fn(async () => bitmapOf(4000, 3000) as unknown as ImageBitmap);
			const camera = createCamera({}, env);
			await camera.start();
			await camera.setZoom(2);
			const result = await camera.capture({ videoWidth: 4000 } as HTMLVideoElement);
			expect(result).toMatchObject({ ok: true, photo: { width: 2000, height: 1500 } });
			expect(drawn).toEqual([[1000, 750, 2000, 1500, 0, 0, 2000, 1500]]);
		});

		it('crops a zoomed full-resolution still to what the 16:9 viewfinder showed', async () => {
			const drawn = stubCanvas();
			const env = fakeEnv(() => fakeTrack({}, { width: 4000, height: 2250 }));
			env.ImageCapture = class {
				async takePhoto() {
					return new Blob(['still']);
				}
			};
			env.createImageBitmap = vi.fn(async () => bitmapOf(4000, 3000) as unknown as ImageBitmap);
			const camera = createCamera({}, env);
			await camera.start();
			await camera.setZoom(2);
			const result = await camera.capture(video);
			expect(result).toMatchObject({ ok: true, photo: { width: 2000, height: 1125 } });
			expect(drawn).toEqual([[1000, 938, 2000, 1125, 0, 0, 2000, 1125]]);
		});

		it('keeps the zoom shown at the shutter if the camera stops or zooms meanwhile', async () => {
			const drawn = stubCanvas();
			const env = fakeEnv(() => fakeTrack({}, { width: 4000, height: 3000 }));
			let frame!: (bitmap: ImageBitmap) => void;
			env.createImageBitmap = vi.fn(() => new Promise<ImageBitmap>((resolve) => (frame = resolve)));
			const camera = createCamera({}, env);
			await camera.start();
			await camera.setZoom(2);
			const result = camera.capture({ videoWidth: 4000 } as HTMLVideoElement);
			await camera.setZoom(1);
			camera.suspend();
			frame(bitmapOf(4000, 3000) as unknown as ImageBitmap);
			expect(await result).toMatchObject({ ok: true, photo: { width: 2000, height: 1500 } });
			expect(drawn).toEqual([[1000, 750, 2000, 1500, 0, 0, 2000, 1500]]);
		});

		it('returns an error, not a rejection, without createImageBitmap', async () => {
			stubCanvas();
			vi.stubGlobal('createImageBitmap', undefined);
			const camera = createCamera({}, fakeEnv());
			await camera.start();
			expect(await camera.capture(video)).toEqual({ ok: false, error: MESSAGES.noFrame });
		});

		it('refuses while the camera is off, with no frame, or mid-capture', async () => {
			stubCanvas();
			const env = fakeEnv();
			let release!: () => void;
			env.createImageBitmap = vi.fn(
				() =>
					new Promise<ImageBitmap>(
						(r) => (release = () => r(bitmapOf(10, 10) as unknown as ImageBitmap))
					)
			);
			const camera = createCamera({}, env);
			expect(await camera.capture(video)).toEqual({ ok: false, error: MESSAGES.off });
			await camera.start();
			expect(await camera.capture(null)).toEqual({ ok: false, error: MESSAGES.noFrame });
			const first = camera.capture(video);
			expect(camera.capturing).toBe(true);
			expect(await camera.capture(video)).toEqual({ ok: false, error: MESSAGES.still });
			release();
			expect(await first).toMatchObject({ ok: true });
		});
	});
});
