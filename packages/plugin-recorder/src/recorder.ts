/**
 * The recorder (#150): one microphone, on only while recording, through `getUserMedia` and
 * `MediaRecorder` alone. Audio is saved as it arrives (`timeslice` chunks, see `recordings.ts`),
 * so a crash loses at most the last few seconds. Framework-agnostic and safe to import during
 * prerender: browser APIs are reached only when a method is called, through `env` (the real
 * browser by default), so tests can stand one in.
 *
 * Mobile browsers may cut the microphone off while the app is in the background (iOS does). When
 * the track ends or the recorder fails mid-recording, it stops cleanly, keeps what was recorded and
 * says why in `notice`: it never claims to record in the background where it can't.
 */
import { pickFormat } from './format.js';
import type { FinishResult, Recordings, Take } from './recordings.js';

export type RecorderState =
	'idle' | 'asking' | 'recording' | 'paused' | 'denied' | 'unavailable' | 'error';

export interface RecorderOptions {
	/**
	 * The browser's voice processing, on by default (it suits voice notes). These are constraints
	 * the browser may ignore.
	 */
	echoCancellation?: boolean;
	noiseSuppression?: boolean;
	autoGainControl?: boolean;
	/** How often a chunk is saved while recording, in ms. Default 3000. */
	timeslice?: number;
}

/** What the recorder uses of a `MediaRecorder`. */
export interface MediaRecorderLike {
	readonly mimeType: string;
	start(timeslice?: number): void;
	pause(): void;
	resume(): void;
	stop(): void;
	ondataavailable: ((event: { data: Blob }) => void) | null;
	onstop: (() => void) | null;
	onerror: ((event: unknown) => void) | null;
}

export interface MediaRecorderConstructor {
	new (stream: MediaStream, options?: { mimeType?: string }): MediaRecorderLike;
	isTypeSupported?(type: string): boolean;
}

/** What the level meter uses of an `AudioContext`. */
export interface AudioContextLike {
	createMediaStreamSource(stream: MediaStream): { connect(node: unknown): unknown };
	createAnalyser(): {
		fftSize: number;
		getFloatTimeDomainData(array: Float32Array<ArrayBuffer>): void;
	};
	close(): Promise<void>;
}

/** The browser APIs the recorder uses; the real ones unless a test passes its own. */
export interface RecorderEnv {
	media?: Pick<MediaDevices, 'getUserMedia'>;
	MediaRecorder?: MediaRecorderConstructor;
	/** `null` for none (no level meter). */
	AudioContext?: (new () => AudioContextLike) | null;
	secure?: boolean;
	now?: () => number;
	/** Whether the page is hidden now. */
	hidden?: () => boolean;
}

export interface Recorder {
	readonly state: RecorderState;
	/** A sentence for `denied`, `unavailable` and `error`; empty otherwise. */
	readonly error: string;
	/**
	 * Why the last recording stopped on its own (the microphone was cut off, often in the
	 * background), once it's saved; empty otherwise. Cleared by the next `start`.
	 */
	readonly notice: string;
	/** True from `stop` until the recording is saved. */
	readonly saving: boolean;
	/** Recording, paused or saving: a reload now would cut it short (`markBusy`). */
	readonly busy: boolean;
	/** Calls `listener` on every change; returns a function that stops it. */
	onChange(listener: () => void): () => void;
	/** Starts recording. Call it from a tap: browsers ask for the microphone here. */
	start(): Promise<RecorderState>;
	pause(): void;
	resume(): void;
	/** How much has been recorded, in ms, not counting pauses. */
	elapsed(): number;
	/** The input level now, 0 to 1, for a meter (0 without one). */
	level(): number;
	/**
	 * Stops and saves the recording (with `name`, if given). Undefined when nothing was being
	 * recorded.
	 */
	stop(name?: string): Promise<FinishResult | undefined>;
	/**
	 * Stops and saves the recording like `stop`, and says why in `notice` (`reason`, a sentence):
	 * for something other than the person that cut it short, such as the app locking.
	 */
	interrupt(reason: string): Promise<FinishResult | undefined>;
	/** Stops and throws away what was recorded. */
	discard(): Promise<void>;
}

export const MESSAGES = {
	insecure: 'The microphone only works on a secure (https) page.',
	unsupported: "This browser can't record audio.",
	denied:
		"Microphone access is blocked. Allow the microphone for this site in your browser's settings, then try again.",
	notFound: 'No microphone was found.',
	busy: 'The microphone is in use by another app, or could not start. Close the other app and try again.',
	failed: "Recording couldn't start.",
	ended:
		'Recording stopped: the microphone was turned off by the system or another app. What was recorded is saved.',
	background:
		'Recording stopped when the app went to the background: this browser turns the microphone off there. What was recorded is saved.',
	broke: 'Recording stopped because of an error. What was recorded is saved.',
	locked: 'Recording stopped when the app locked. What was recorded is saved.'
} as const;

export const DEFAULT_TIMESLICE = 3000;

/** What `getUserMedia` asks for: the voice processing options given, the browser's default otherwise. */
export function audioConstraints(options: RecorderOptions): MediaStreamConstraints {
	const audio: MediaTrackConstraints = {};
	for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const)
		if (options[key] !== undefined) audio[key] = options[key];
	return { audio: Object.keys(audio).length ? audio : true };
}

/** The state and message for a `getUserMedia` or `MediaRecorder` failure. */
function failure(error: unknown): { state: RecorderState; error: string } {
	const name = (error as { name?: unknown } | null)?.name;
	if (name === 'NotAllowedError' || name === 'SecurityError')
		return { state: 'denied', error: MESSAGES.denied };
	if (name === 'NotFoundError' || name === 'OverconstrainedError')
		return { state: 'unavailable', error: MESSAGES.notFound };
	if (name === 'NotReadableError' || name === 'AbortError')
		return { state: 'error', error: MESSAGES.busy };
	return { state: 'error', error: MESSAGES.failed };
}

/** The real browser's APIs, looked up when used. */
function browser(env: RecorderEnv) {
	const g = globalThis as {
		navigator?: { mediaDevices?: Pick<MediaDevices, 'getUserMedia'> };
		MediaRecorder?: MediaRecorderConstructor;
		AudioContext?: new () => AudioContextLike;
		isSecureContext?: boolean;
		document?: { visibilityState?: string };
	};
	return {
		media: env.media ?? g.navigator?.mediaDevices,
		MediaRecorder: env.MediaRecorder ?? g.MediaRecorder,
		AudioContext: env.AudioContext === null ? undefined : (env.AudioContext ?? g.AudioContext),
		secure: env.secure ?? g.isSecureContext ?? true,
		now: env.now ?? Date.now,
		hidden: env.hidden ?? (() => g.document?.visibilityState === 'hidden')
	};
}

export function createRecorder(
	store: Pick<Recordings, 'begin'>,
	options: RecorderOptions = {},
	env: RecorderEnv = {}
): Recorder {
	const timeslice = options.timeslice ?? DEFAULT_TIMESLICE;
	const listeners = new Set<() => void>();
	let state: RecorderState = 'idle';
	let error = '';
	let notice = '';
	let saving = false;

	let stream: MediaStream | null = null;
	let recorder: MediaRecorderLike | null = null;
	let take: Take | null = null;
	let audio: AudioContextLike | null = null;
	let analyser: ReturnType<AudioContextLike['createAnalyser']> | null = null;
	let samples: Float32Array<ArrayBuffer> | null = null;
	/** Recorded before the current stretch (ms), and when the current one began. */
	let before = 0;
	let since = 0;
	/** Bumped by every start, stop and discard, so a start that finishes late knows it's stale. */
	let generation = 0;

	const now = () => browser(env).now();
	const emit = () => {
		for (const l of [...listeners]) l();
	};
	const set = (next: RecorderState, message = '') => {
		state = next;
		error = message;
		emit();
	};
	const elapsed = () => before + (state === 'recording' ? Math.max(0, now() - since) : 0);

	function release() {
		for (const track of stream?.getTracks() ?? []) {
			track.onended = null;
			track.stop();
		}
		stream = null;
		if (recorder) {
			recorder.ondataavailable = null;
			recorder.onstop = null;
			recorder.onerror = null;
		}
		recorder = null;
		void audio?.close().catch(() => {});
		audio = null;
		analyser = null;
		samples = null;
	}

	/** Stops the recorder and waits for its last chunk. */
	function halt(r: MediaRecorderLike): Promise<void> {
		return new Promise((resolve) => {
			const prior = r.onstop;
			r.onstop = () => {
				prior?.();
				resolve();
			};
			r.onerror = () => resolve();
			try {
				r.stop();
			} catch {
				resolve();
			}
		});
	}

	/** Ends the recording: `keep` saves it (with `name`), otherwise it's thrown away. */
	async function end(keep: boolean, name?: string): Promise<FinishResult | undefined> {
		if (state !== 'recording' && state !== 'paused') return undefined;
		generation++;
		before = elapsed();
		const r = recorder!;
		const t = take!;
		saving = keep;
		set('idle');
		await halt(r);
		release();
		take = null;
		try {
			if (!keep) {
				await t.discard();
				return undefined;
			}
			return await t.finish(name);
		} finally {
			saving = false;
			emit();
		}
	}

	/** Stops, saves and says why. */
	async function interrupt(reason: string) {
		if (state === 'asking') {
			generation++;
			set('idle');
			return undefined;
		}
		if (state !== 'recording' && state !== 'paused') return undefined;
		const result = await end(true);
		notice = reason;
		emit();
		return result;
	}

	/** The microphone went away mid-recording: keep what's there and say why. */
	function interrupted(message: string) {
		if (state !== 'recording' && state !== 'paused') return;
		void interrupt(browser(env).hidden() ? MESSAGES.background : message);
	}

	return {
		get state() {
			return state;
		},
		get error() {
			return error;
		},
		get notice() {
			return notice;
		},
		get saving() {
			return saving;
		},
		get busy() {
			return state === 'recording' || state === 'paused' || saving;
		},
		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async start() {
			if (state === 'asking' || state === 'recording' || state === 'paused' || saving) return state;
			const api = browser(env);
			notice = '';
			if (!api.secure) {
				set('unavailable', MESSAGES.insecure);
				return state;
			}
			if (!api.media?.getUserMedia || !api.MediaRecorder) {
				set('unavailable', MESSAGES.unsupported);
				return state;
			}
			const mine = ++generation;
			set('asking');
			let got: MediaStream;
			try {
				got = await api.media.getUserMedia(audioConstraints(options));
			} catch (cause) {
				if (mine === generation) {
					const f = failure(cause);
					set(f.state, f.error);
				}
				return state;
			}
			// Stopped (or started again) while the browser was asking.
			if (mine !== generation) {
				for (const track of got.getTracks()) track.stop();
				return state;
			}
			stream = got;
			const format = pickFormat(api.MediaRecorder.isTypeSupported?.bind(api.MediaRecorder));
			let r: MediaRecorderLike;
			try {
				r = new api.MediaRecorder(got, format ? { mimeType: format.type } : undefined);
			} catch {
				release();
				set('error', MESSAGES.failed);
				return state;
			}
			recorder = r;
			before = 0;
			since = api.now();
			const type = r.mimeType || format?.type || 'audio/webm';
			const t = (take = store.begin(type, since));
			r.ondataavailable = (event) => {
				if (event.data && event.data.size > 0) void t.append(event.data, elapsed());
			};
			r.onerror = () => interrupted(MESSAGES.broke);
			for (const track of got.getAudioTracks()) track.onended = () => interrupted(MESSAGES.ended);
			if (api.AudioContext) {
				try {
					audio = new api.AudioContext();
					analyser = audio.createAnalyser();
					analyser.fftSize = 2048;
					samples = new Float32Array(analyser.fftSize);
					audio.createMediaStreamSource(got).connect(analyser);
				} catch {
					// No meter; recording works without one.
					audio = null;
					analyser = null;
				}
			}
			try {
				r.start(timeslice);
			} catch (cause) {
				release();
				take = null;
				void t.discard();
				const f = failure(cause);
				set(f.state, f.error);
				return state;
			}
			set('recording');
			return state;
		},
		pause() {
			if (state !== 'recording' || !recorder) return;
			try {
				recorder.pause();
			} catch {
				return;
			}
			before = elapsed();
			set('paused');
		},
		resume() {
			if (state !== 'paused' || !recorder) return;
			try {
				recorder.resume();
			} catch {
				return;
			}
			since = now();
			set('recording');
		},
		elapsed,
		level() {
			if (state !== 'recording' || !analyser || !samples) return 0;
			analyser.getFloatTimeDomainData(samples);
			let sum = 0;
			for (const s of samples) sum += s * s;
			// RMS, scaled so speech fills most of the meter.
			return Math.min(1, Math.sqrt(sum / samples.length) * 4);
		},
		stop(name) {
			if (state === 'asking') {
				generation++;
				set('idle');
				return Promise.resolve(undefined);
			}
			return end(true, name);
		},
		interrupt,
		async discard() {
			if (state === 'asking') {
				generation++;
				set('idle');
				return;
			}
			await end(false);
		}
	};
}
