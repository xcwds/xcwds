import { createBlobs, memoryBlobs } from '@xcwds/core';
import { describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_TIMESLICE,
	MESSAGES,
	audioConstraints,
	createRecorder,
	type MediaRecorderLike,
	type RecorderEnv
} from './recorder.js';
import { createRecordings } from './recordings.js';

const TYPE = 'audio/webm;codecs=opus';

class FakeTrack {
	stopped = false;
	onended: (() => void) | null = null;
	stop() {
		this.stopped = true;
	}
}

class FakeStream {
	track = new FakeTrack();
	getTracks() {
		return [this.track];
	}
	getAudioTracks() {
		return [this.track];
	}
}

/** Records nothing on its own: tests feed it with `say`. */
class FakeRecorder implements MediaRecorderLike {
	static last: FakeRecorder | null = null;
	static supported = [TYPE];
	static isTypeSupported(type: string) {
		return FakeRecorder.supported.includes(type);
	}
	state: 'inactive' | 'recording' | 'paused' = 'inactive';
	timeslice: number | undefined;
	mimeType: string;
	ondataavailable: ((event: { data: Blob }) => void) | null = null;
	onstop: (() => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	/** What's been said since the last chunk. */
	pending = '';
	constructor(
		public stream: FakeStream,
		options?: { mimeType?: string }
	) {
		this.mimeType = options?.mimeType ?? 'audio/mp4';
		FakeRecorder.last = this;
	}
	start(timeslice?: number) {
		this.timeslice = timeslice;
		this.state = 'recording';
	}
	pause() {
		this.state = 'paused';
	}
	resume() {
		this.state = 'recording';
	}
	stop() {
		this.state = 'inactive';
		// As browsers do: the last chunk, then `stop`, asynchronously.
		queueMicrotask(() => {
			this.flush();
			this.onstop?.();
		});
	}
	say(words: string) {
		if (this.state === 'recording') this.pending += words;
	}
	/** A timeslice passed. */
	flush() {
		const data = new Blob([this.pending], { type: this.mimeType });
		this.pending = '';
		this.ondataavailable?.({ data });
	}
}

function setup(env: Partial<RecorderEnv> = {}) {
	const blobs = createBlobs({ backend: memoryBlobs() });
	const recordings = createRecordings(blobs.scope('recorder'), {}, { locks: null });
	let clock = 1000;
	let hidden = false;
	const stream = new FakeStream();
	const getUserMedia = vi.fn(async () => stream as unknown as MediaStream);
	const recorder = createRecorder(
		recordings,
		{},
		{
			media: { getUserMedia },
			MediaRecorder: FakeRecorder as never,
			AudioContext: null,
			secure: true,
			now: () => clock,
			hidden: () => hidden,
			...env
		}
	);
	return {
		recordings,
		recorder,
		stream,
		getUserMedia,
		tick: (ms: number) => (clock += ms),
		hide: () => (hidden = true),
		media: () => FakeRecorder.last!
	};
}

const text = async (blob: Blob) => new TextDecoder().decode(await blob.arrayBuffer());
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the recorder', () => {
	it('records in chunks, pauses, and saves one recording on stop', async () => {
		const s = setup();
		expect(await s.recorder.start()).toBe('recording');
		expect(s.getUserMedia).toHaveBeenCalledWith({ audio: true });
		const media = s.media();
		expect(media.mimeType).toBe(TYPE);
		expect(media.timeslice).toBe(DEFAULT_TIMESLICE);
		expect(s.recorder.busy).toBe(true);

		media.say('Buy eggs, ');
		s.tick(3000);
		media.flush();
		expect(s.recorder.elapsed()).toBe(3000);
		s.recorder.pause();
		expect(s.recorder.state).toBe('paused');
		media.say('(not this) ');
		s.tick(10_000);
		expect(s.recorder.elapsed()).toBe(3000);
		s.recorder.resume();
		media.say('milk and bread.');
		s.tick(2000);

		const result = await s.recorder.stop('Groceries');
		expect(result?.ok).toBe(true);
		expect(s.recorder.state).toBe('idle');
		expect(s.recorder.busy).toBe(false);
		expect(s.stream.track.stopped).toBe(true);
		const [saved] = await s.recordings.list();
		expect(saved).toMatchObject({
			name: 'Groceries',
			duration: 5000,
			recordedAt: 1000,
			type: TYPE
		});
		expect(await text((await s.recordings.get(saved!.id))!.blob)).toBe('Buy eggs, milk and bread.');
	});

	it('asks for the voice processing options given, and the default otherwise', () => {
		expect(audioConstraints({})).toEqual({ audio: true });
		expect(audioConstraints({ noiseSuppression: false, echoCancellation: true })).toEqual({
			audio: { noiseSuppression: false, echoCancellation: true }
		});
	});

	it('lets the browser pick a format when it supports none of ours', async () => {
		FakeRecorder.supported = [];
		try {
			const s = setup();
			await s.recorder.start();
			s.media().say('hello');
			const result = await s.recorder.stop();
			expect(result?.ok).toBe(true);
			expect((await s.recordings.list())[0]?.type).toBe('audio/mp4');
		} finally {
			FakeRecorder.supported = [TYPE];
		}
	});

	it('throws a discarded recording away', async () => {
		const s = setup();
		await s.recorder.start();
		s.media().say('never mind');
		s.media().flush();
		await s.recorder.discard();
		expect(s.recorder.state).toBe('idle');
		expect(await s.recordings.list()).toEqual([]);
		expect(s.stream.track.stopped).toBe(true);
	});

	describe('when the microphone goes away', () => {
		it('saves what was recorded and says why', async () => {
			const s = setup();
			await s.recorder.start();
			s.media().say('half a thought');
			s.stream.track.onended?.();
			await settle();
			await settle();
			expect(s.recorder.state).toBe('idle');
			expect(s.recorder.notice).toBe(MESSAGES.ended);
			expect(await text((await s.recordings.get((await s.recordings.list())[0]!.id))!.blob)).toBe(
				'half a thought'
			);
			// The next recording clears it.
			await s.recorder.start();
			expect(s.recorder.notice).toBe('');
		});

		it("says the browser stops it in the background, where that's what happened", async () => {
			const s = setup();
			await s.recorder.start();
			s.media().say('walking');
			s.hide();
			s.stream.track.onended?.();
			await settle();
			await settle();
			expect(s.recorder.notice).toBe(MESSAGES.background);
			expect(await s.recordings.list()).toHaveLength(1);
		});

		it('saves what was recorded when the recorder fails', async () => {
			const s = setup();
			await s.recorder.start();
			s.media().say('so far');
			s.media().onerror?.(new Error('boom'));
			await settle();
			await settle();
			expect(s.recorder.notice).toBe(MESSAGES.broke);
			expect(await s.recordings.list()).toHaveLength(1);
		});
	});

	it('says why when something else stops it', async () => {
		const s = setup();
		expect(await s.recorder.interrupt(MESSAGES.locked)).toBeUndefined();
		expect(s.recorder.notice).toBe('');
		await s.recorder.start();
		s.media().say('cut short');
		const result = await s.recorder.interrupt(MESSAGES.locked);
		expect(result?.ok).toBe(true);
		expect(s.recorder.state).toBe('idle');
		expect(s.recorder.notice).toBe(MESSAGES.locked);
		expect(await s.recordings.list()).toHaveLength(1);
	});

	describe("can't start", () => {
		it('on an insecure page or without the APIs', async () => {
			expect(await setup({ secure: false }).recorder.start()).toBe('unavailable');
			const none = setup({ MediaRecorder: undefined as never, media: {} as never });
			// Fall back to the real globals, which Node lacks.
			expect(await none.recorder.start()).toBe('unavailable');
			expect(none.recorder.error).toBe(MESSAGES.unsupported);
		});

		it('when the microphone is refused, missing or busy', async () => {
			const cases: [string, string, string][] = [
				['NotAllowedError', 'denied', MESSAGES.denied],
				['NotFoundError', 'unavailable', MESSAGES.notFound],
				['NotReadableError', 'error', MESSAGES.busy],
				['TypeError', 'error', MESSAGES.failed]
			];
			for (const [name, state, message] of cases) {
				const s = setup({
					media: {
						getUserMedia: async () => {
							throw Object.assign(new Error(name), { name });
						}
					}
				});
				expect(await s.recorder.start()).toBe(state);
				expect(s.recorder.error).toBe(message);
			}
		});

		it('and lets go of a microphone granted after it was stopped', async () => {
			let grant!: (stream: MediaStream) => void;
			const stream = new FakeStream();
			const s = setup({
				media: { getUserMedia: () => new Promise<MediaStream>((r) => (grant = r)) }
			});
			const starting = s.recorder.start();
			expect(s.recorder.state).toBe('asking');
			expect(await s.recorder.stop()).toBeUndefined();
			grant(stream as unknown as MediaStream);
			expect(await starting).toBe('idle');
			expect(stream.track.stopped).toBe(true);
		});
	});

	it('reports a level from the analyser while recording', async () => {
		class FakeAudio {
			closed = false;
			createMediaStreamSource() {
				return { connect: () => undefined };
			}
			createAnalyser() {
				return {
					fftSize: 0,
					getFloatTimeDomainData(array: Float32Array) {
						array.fill(0.1);
					}
				};
			}
			async close() {
				this.closed = true;
			}
		}
		const s = setup({ AudioContext: FakeAudio as never });
		expect(s.recorder.level()).toBe(0);
		await s.recorder.start();
		expect(s.recorder.level()).toBeCloseTo(0.4);
		s.recorder.pause();
		expect(s.recorder.level()).toBe(0);
	});

	it('tells listeners about each change', async () => {
		const s = setup();
		const seen: string[] = [];
		const stop = s.recorder.onChange(() => seen.push(s.recorder.state));
		await s.recorder.start();
		s.recorder.pause();
		s.recorder.resume();
		await s.recorder.stop();
		stop();
		await s.recorder.start();
		expect(seen).toEqual(['asking', 'recording', 'paused', 'recording', 'idle', 'idle']);
	});
});
