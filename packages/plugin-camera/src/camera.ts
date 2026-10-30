/**
 * The camera controller (#145): one camera, on only while it's used, through `getUserMedia` alone.
 * Framework-agnostic and safe to import during prerender: browser APIs are reached only when a
 * method is called, through `env` (the real browser by default), so tests can stand one in.
 *
 * The plugin's page entry (`client.ts`) hands one controller to the app as `app.camera` and
 * stops it when the page is hidden or the app locks (`suspend`/`resume`); the viewfinder component
 * renders `stream` in a `<video>` and passes that element to `capture`.
 */
import { encode, fitSize, imageQuality, imageType, type Crop, type ImageType } from './clean.js';

export type CameraState = 'idle' | 'asking' | 'live' | 'denied' | 'unavailable' | 'error';
export type Facing = 'environment' | 'user';

export interface CameraOptions {
	/** Which camera `start()` asks for first. Default `environment` (the back camera). */
	facing?: Facing;
	/** What `capture()` writes. Default `image/jpeg`. */
	type?: ImageType;
	/** Encoder quality, 0 to 1. Default 0.92. */
	quality?: number;
	/** Scale photos down so neither side is longer than this. Default: full size. */
	maxSide?: number;
	/** The most digital zoom offers, before the 1-megapixel floor. Default 4. */
	maxDigitalZoom?: number;
}

export interface Photo {
	blob: Blob;
	width: number;
	height: number;
	/** The type the browser actually wrote. */
	type: string;
	/** When the shutter was pressed, in ms since the epoch. */
	takenAt: number;
}

export type CaptureResult = { ok: true; photo: Photo } | { ok: false; error: string };

export interface Zoom {
	/** `hardware`: the camera's own zoom. `digital`: a crop of the stream, adding no detail. */
	kind: 'hardware' | 'digital';
	min: number;
	max: number;
	step: number;
	value: number;
}

export interface Capabilities {
	/** Null while the camera is off, or when even digital zoom would drop under 1 megapixel. */
	zoom: Zoom | null;
	/** Whether the camera has a light `setTorch` can turn on. */
	torch: boolean;
	/** Whether that light is on. */
	torchOn: boolean;
}

/** The browser APIs the controller uses; the real ones unless a test passes its own. */
export interface CameraEnv {
	media?: Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>;
	secure?: boolean;
	ImageCapture?: new (track: MediaStreamTrack) => { takePhoto(): Promise<Blob> };
	createImageBitmap?: (
		source: ImageBitmapSource,
		options?: ImageBitmapOptions
	) => Promise<ImageBitmap>;
	now?: () => number;
}

export interface Camera {
	readonly state: CameraState;
	/** A sentence for `denied`, `unavailable` and `error`; empty otherwise. */
	readonly error: string;
	/** The live stream, for a `<video>`; null unless `live`. */
	readonly stream: MediaStream | null;
	readonly facing: Facing;
	/** True from the shutter until the photo is encoded. */
	readonly capturing: boolean;
	/** Calls `listener` on every change; returns a function that stops it. */
	onChange(listener: () => void): () => void;
	/** Turns the camera on. Call it from a tap: browsers ask for permission here. */
	start(facing?: Facing): Promise<CameraState>;
	/** Turns the camera off and forgets it was on. */
	stop(): void;
	/** Turns the camera off for now (page hidden, app locked), remembering whether it was on. */
	suspend(): void;
	/** Turns it back on after `suspend()` if it was on then. */
	resume(): Promise<CameraState>;
	/** How many cameras there are (labels need permission, the count doesn't). */
	cameras(): Promise<number>;
	/** Starts the other camera, front or back. */
	switchFacing(): Promise<CameraState>;
	capabilities(): Capabilities;
	/** Sets the zoom (clamped to `capabilities().zoom`). */
	setZoom(value: number): Promise<void>;
	setTorch(on: boolean): Promise<void>;
	/**
	 * Takes a photo, re-encoded from pixels so it carries no metadata. Uses the camera's full
	 * resolution where `ImageCapture` works, else the current frame of `video` (the viewfinder).
	 */
	capture(video?: HTMLVideoElement | null): Promise<CaptureResult>;
}

export const MESSAGES = {
	insecure: 'The camera only works on a secure (https) page.',
	unsupported: "This browser can't use the camera.",
	denied:
		"Camera access is blocked. Allow the camera for this site in your browser's settings, then try again.",
	notFound: 'No camera was found.',
	busy: 'The camera is in use by another app, or could not start. Close the other app and try again.',
	failed: "The camera couldn't start.",
	ended: 'The camera was turned off by the system or another app.',
	off: "The camera isn't on.",
	still: 'Still saving the last photo.',
	noFrame: "Couldn't get a picture from the camera. Try again.",
	notSaved: "The photo couldn't be saved. Try again."
} as const;

/** Under this many pixels a digital crop isn't worth keeping. */
const MIN_PIXELS = 1_000_000;

/** The most digital zoom a `width`×`height` stream allows: the crop stays above 1 megapixel. */
export function digitalZoomLimit(width: number, height: number, cap = 4): number {
	if (!(width > 0 && height > 0)) return 1;
	const limit = Math.min(
		Number.isFinite(cap) && cap >= 1 ? cap : 4,
		Math.sqrt((width * height) / MIN_PIXELS)
	);
	return Math.max(1, Math.floor(limit * 10) / 10);
}

/** The centre `1/zoom` of a `width`×`height` frame. */
export function centreCrop(width: number, height: number, zoom: number): Crop {
	const w = Math.max(1, Math.round(width / zoom));
	const h = Math.max(1, Math.round(height / zoom));
	return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), width: w, height: h };
}

/**
 * The region of a `width`×`height` frame that a viewfinder of `aspect` (width / height) zoomed by
 * `zoom` showed: the largest centred area of that shape, then its centre `1/zoom`. A full-
 * resolution still is often 4:3 while the viewfinder is 16:9, so cropping the still by the zoom
 * alone would keep more than was shown.
 */
export function zoomCrop(width: number, height: number, aspect: number, zoom: number): Crop {
	let w = width;
	let h = height;
	if (Number.isFinite(aspect) && aspect > 0) {
		if (width / height > aspect) w = height * aspect;
		else h = width / aspect;
	}
	const inner = centreCrop(w, h, zoom);
	return {
		...inner,
		x: Math.round((width - inner.width) / 2),
		y: Math.round((height - inner.height) / 2)
	};
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function failure(error: unknown): { state: CameraState; error: string } {
	const name = error instanceof Error || error instanceof DOMException ? error.name : '';
	switch (name) {
		case 'NotAllowedError':
		case 'SecurityError':
		case 'PermissionDeniedError':
			return { state: 'denied', error: MESSAGES.denied };
		case 'NotFoundError':
		case 'DevicesNotFoundError':
		case 'OverconstrainedError':
			return { state: 'unavailable', error: MESSAGES.notFound };
		case 'NotReadableError':
		case 'TrackStartError':
		case 'AbortError':
			return { state: 'error', error: MESSAGES.busy };
		default:
			return { state: 'error', error: MESSAGES.failed };
	}
}

type TrackCapabilities = MediaTrackCapabilities & {
	zoom?: { min: number; max: number; step?: number };
	torch?: boolean;
};

export function createCamera(options: CameraOptions = {}, env: CameraEnv = {}): Camera {
	const type = imageType(options.type);
	const quality = imageQuality(options.quality);
	const listeners = new Set<() => void>();
	let state: CameraState = 'idle';
	let error = '';
	let stream: MediaStream | null = null;
	let facing: Facing = options.facing === 'user' ? 'user' : 'environment';
	let capturing = false;
	let digitalZoom = 1;
	let hardwareZoom: number | undefined;
	let torch = false;
	/** Bumped by every start and stop, so a permission answer that comes late is dropped. */
	let generation = 0;
	let suspended = false;

	const media = () =>
		env.media ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined);
	const secure = () =>
		env.secure ?? (typeof isSecureContext === 'undefined' ? true : isSecureContext);
	// Async, so a missing API is a rejection the callers handle rather than a throw.
	const bitmap = async (source: ImageBitmapSource, opts?: ImageBitmapOptions) =>
		(env.createImageBitmap ?? createImageBitmap)(source, opts);
	const now = () => (env.now ?? Date.now)();
	const track = () => stream?.getVideoTracks()[0];

	const emit = () => {
		for (const listener of listeners) listener();
	};
	const set = (next: CameraState, message = '') => {
		state = next;
		error = message;
		emit();
	};
	const release = () => {
		for (const t of stream?.getTracks() ?? []) t.stop();
		stream = null;
		digitalZoom = 1;
		hardwareZoom = undefined;
		torch = false;
	};

	async function start(next: Facing = facing): Promise<CameraState> {
		const devices = media();
		if (!secure()) {
			set('unavailable', MESSAGES.insecure);
			return state;
		}
		if (!devices?.getUserMedia) {
			set('unavailable', MESSAGES.unsupported);
			return state;
		}
		const run = ++generation;
		release();
		facing = next;
		suspended = false;
		set('asking');
		let got: MediaStream;
		try {
			got = await devices.getUserMedia({
				audio: false,
				video: { facingMode: { ideal: next }, width: { ideal: 1920 }, height: { ideal: 1080 } }
			});
		} catch (e) {
			if (run !== generation) return state;
			const f = failure(e);
			set(f.state, f.error);
			return state;
		}
		// Stopped (or restarted) while the browser was asking: this stream isn't wanted.
		if (run !== generation) {
			for (const t of got.getTracks()) t.stop();
			return state;
		}
		stream = got;
		track()?.addEventListener('ended', () => {
			if (run !== generation || stream !== got) return;
			release();
			set('error', MESSAGES.ended);
		});
		set('live');
		return state;
	}

	function stop() {
		generation++;
		suspended = false;
		release();
		set('idle');
	}

	const zoomOf = (): Zoom | null => {
		const t = track();
		if (state !== 'live' || !t) return null;
		const caps = (t.getCapabilities?.() ?? {}) as TrackCapabilities;
		if (caps.zoom && caps.zoom.max > caps.zoom.min) {
			const { min, max } = caps.zoom;
			const current = (t.getSettings() as { zoom?: number }).zoom;
			return {
				kind: 'hardware',
				min,
				max,
				step: caps.zoom.step || 0.1,
				value: hardwareZoom ?? current ?? min
			};
		}
		const { width = 0, height = 0 } = t.getSettings();
		const max = digitalZoomLimit(width, height, options.maxDigitalZoom);
		if (max <= 1) return null;
		return { kind: 'digital', min: 1, max, step: 0.1, value: digitalZoom };
	};

	return {
		get state() {
			return state;
		},
		get error() {
			return error;
		},
		get stream() {
			return state === 'live' ? stream : null;
		},
		get facing() {
			return facing;
		},
		get capturing() {
			return capturing;
		},
		onChange(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		start,
		stop,
		suspend() {
			if (state !== 'live' && state !== 'asking') return;
			generation++;
			release();
			suspended = true;
			set('idle');
		},
		async resume() {
			if (!suspended) return state;
			return start(facing);
		},
		async cameras() {
			try {
				const devices = (await media()?.enumerateDevices()) ?? [];
				return devices.filter((d) => d.kind === 'videoinput').length;
			} catch {
				return 0;
			}
		},
		switchFacing() {
			return start(facing === 'user' ? 'environment' : 'user');
		},
		capabilities() {
			const t = track();
			const caps = (state === 'live' ? (t?.getCapabilities?.() ?? {}) : {}) as TrackCapabilities;
			return { zoom: zoomOf(), torch: caps.torch === true, torchOn: torch };
		},
		async setZoom(value) {
			const zoom = zoomOf();
			if (!zoom || !Number.isFinite(value)) return;
			const next = clamp(value, zoom.min, zoom.max);
			if (zoom.kind === 'digital') digitalZoom = next;
			else {
				// Only a zoom the camera took counts: a rejected one leaves the value as it was.
				await track()
					?.applyConstraints({ advanced: [{ zoom: next } as MediaTrackConstraintSet] })
					.then(() => (hardwareZoom = next))
					.catch(() => {});
			}
			emit();
		},
		async setTorch(on) {
			const t = track();
			if (!t || !this.capabilities().torch) return;
			await t
				.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
				.then(() => (torch = on))
				.catch(() => {});
			emit();
		},
		async capture(video) {
			const t = track();
			if (state !== 'live' || !t) return { ok: false, error: MESSAGES.off };
			if (capturing) return { ok: false, error: MESSAGES.still };
			capturing = true;
			emit();
			const takenAt = now();
			// What was shown at the shutter: a suspend or zoom change while the photo is taken
			// mustn't change it.
			const zoom = digitalZoom;
			const { width: shownWidth = 0, height: shownHeight = 0 } = t.getSettings();
			let frame: ImageBitmap | null = null;
			try {
				const Capture =
					env.ImageCapture ??
					(globalThis as { ImageCapture?: CameraEnv['ImageCapture'] }).ImageCapture;
				if (Capture) {
					try {
						const still: unknown = await new Capture(t).takePhoto();
						// Firefox's `dom.imagecapture.enabled` draft returns nothing (its photo
						// comes in an event): use the viewfinder's frame then too.
						if (still instanceof Blob)
							frame = await bitmap(still, { imageOrientation: 'from-image' });
					} catch {
						// Not every camera supports full-resolution stills: use the viewfinder's frame.
					}
				}
				if (!frame && video && video.videoWidth > 0) frame = await bitmap(video).catch(() => null);
				if (!frame) return { ok: false, error: MESSAGES.noFrame };
				const crop =
					zoom > 1
						? zoomCrop(frame.width, frame.height, shownWidth / shownHeight, zoom)
						: undefined;
				const size = fitSize(
					crop?.width ?? frame.width,
					crop?.height ?? frame.height,
					options.maxSide
				);
				const blob = await encode(frame, size.width, size.height, type, quality, crop).catch(
					() => null
				);
				if (!blob || blob.size === 0) return { ok: false, error: MESSAGES.notSaved };
				return { ok: true, photo: { blob, ...size, type: blob.type || type, takenAt } };
			} finally {
				frame?.close();
				capturing = false;
				emit();
			}
		}
	};
}
