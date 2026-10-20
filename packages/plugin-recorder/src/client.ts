/**
 * The page entry: hands the app one recorder as `app.recorder` and its recordings as
 * `app.recordings` (`app:recorder:recordings`, group `recordings`, personal and out of backups),
 * and looks after them whatever page is showing:
 *
 * - **Updates wait.** While recording, paused or saving, an `onBeforeReload` reason holds app
 *   updates back, so an update never cuts a recording short.
 * - **The screen stays on** while recording or paused (a screen wake lock, if the browser has
 *   one): a phone that locks itself would put the app in the background, where some browsers turn
 *   the microphone off. The browser drops the lock when the page is hidden; it's taken again on
 *   return, and let go on stop.
 * - **Recovery.** On boot, recordings left unfinished (the app closed mid-recording) are joined
 *   and kept, marked `recovered`; `app.recordings.recovered` gives their ids.
 * - **Locked app.** When `app.lock` (from `@xcwds/plugin-lock`, if the app has it) locks, the
 *   recording stops and is saved, and `notice` says why. Recovery waits until the app is
 *   unlocked, and runs again on each unlock (a recording that couldn't be saved while locked is
 *   kept for it).
 * - **Closing.** `onClose` stops and saves the recording.
 *
 * Hiding the page doesn't stop it: Android browsers keep recording in the background. Where the
 * browser turns the microphone off instead, the recorder saves what was recorded and says why.
 * Imported at prerender too, so it only touches browser globals once the app boots.
 */
import { definePlugin } from '@xcwds/core';
import { MESSAGES, createRecorder, type Recorder, type RecorderEnv } from './recorder.js';
import { createRecordings, type Recordings, type RecordingsEnv } from './recordings.js';
import { CORE, NAME, resolveOptions, type RecorderPluginOptions } from './options.js';

export type { Recorder, RecorderState } from './recorder.js';
export type { FinishResult, RecordingMeta, SavedRecording } from './recordings.js';

/** `app.recordings`. */
export type AppRecordings = Recordings & {
	/**
	 * The ids of the recordings recovered on boot (or on unlocking), once that's done: empty when
	 * there were none.
	 */
	readonly recovered: Promise<string[]>;
};

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-recorder`. */
		readonly recorder?: Recorder;
		/** From `@xcwds/plugin-recorder`: the recordings kept in the app (`app:recorder:recordings`). */
		readonly recordings?: AppRecordings;
	}
}

/** What this plugin uses of `app.lock` (from `@xcwds/plugin-lock`, if the app has it). */
type LockLike = {
	readonly state: { readonly locked: boolean };
	subscribe(listener: (state: { readonly locked: boolean }) => void): () => void;
};

/** What this plugin uses of a `WakeLockSentinel`. */
export type WakeLockSentinelLike = {
	release(): Promise<void>;
	addEventListener(type: 'release', listener: () => void): void;
};

/** The browser APIs the plugin uses; the real ones unless a test passes its own. */
export type RecorderPluginEnv = {
	recorder?: RecorderEnv;
	recordings?: RecordingsEnv;
	/** `navigator.wakeLock` by default; `null` for none. */
	wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } | null;
	/** Whether the page shows now. */
	visible?: () => boolean;
};

/**
 * What a reload would interrupt. A noun phrase, as plugin-update's banner says "Reloading now will
 * interrupt your {busy}".
 */
export const RECORDING = 'recording';

/**
 * Makes the plugin with the browser APIs in `env` (tests pass stand-ins); the default export uses
 * the real ones.
 */
export function recorderPlugin(env: RecorderPluginEnv = {}) {
	return definePlugin(
		(app, input: RecorderPluginOptions) => {
			const options = resolveOptions(input);
			const store = createRecordings(app.blobs, {}, env.recordings);
			const recorder = createRecorder(store, options, env.recorder);

			let recovering: Promise<unknown> = Promise.resolve();
			/** Joins unfinished recordings, one run at a time, whoever asks. */
			function recover(except?: string[]) {
				const run = recovering.then(() => store.recover(except).catch(() => [] as string[]));
				recovering = run;
				return run;
			}

			let done!: (ids: string[]) => void;
			const recordings: AppRecordings = {
				...store,
				recover,
				recovered: new Promise<string[]>((resolve) => (done = resolve))
			};
			app.decorate('recorder', recorder);
			app.decorate('recordings', recordings);

			const g = globalThis as {
				navigator?: { wakeLock?: RecorderPluginEnv['wakeLock'] };
				document?: { visibilityState?: string };
			};
			const wakeLocks = () =>
				env.wakeLock === null ? undefined : (env.wakeLock ?? g.navigator?.wakeLock ?? undefined);
			const visible = env.visible ?? (() => g.document?.visibilityState !== 'hidden');
			const lock = () => (app as { lock?: LockLike }).lock;
			const recording = () => recorder.state === 'recording' || recorder.state === 'paused';

			let booted = false;
			let wakeLock: WakeLockSentinelLike | undefined;
			let asking = false;
			/** Keeps the screen on while recording and the page shows. */
			async function syncWakeLock() {
				const want = booted && recording() && visible();
				if (want && !wakeLock && !asking) {
					const api = wakeLocks();
					if (!api) return;
					asking = true;
					try {
						const sentinel = await api.request('screen');
						sentinel.addEventListener('release', () => {
							if (wakeLock === sentinel) wakeLock = undefined;
						});
						wakeLock = sentinel;
					} catch {
						// Denied (low battery, unsupported): recording works without it.
					} finally {
						asking = false;
					}
					// Stopped (or hidden) while asking: let it go again.
					if (wakeLock && !(booted && recording() && visible())) void syncWakeLock();
				} else if (!want && wakeLock) {
					const sentinel = wakeLock;
					wakeLock = undefined;
					await sentinel.release().catch(() => {});
				}
			}

			const stops: (() => void)[] = [];
			app.addHook('onBoot', () => {
				booted = true;
				stops.push(recorder.onChange(() => void syncWakeLock()));
				// Registered after every plugin, so it finds the lock whichever comes first.
				let locked: boolean | undefined;
				const unsubscribe = lock()?.subscribe((state) => {
					if (state.locked === locked) return;
					locked = state.locked;
					if (locked) void recorder.interrupt(MESSAGES.locked);
					else void recover().then(done);
				});
				if (unsubscribe) stops.push(unsubscribe);
				else void recover().then(done);
			});
			app.addHook('onBeforeReload', () => (recorder.busy ? RECORDING : undefined));
			app.addHook('onVisible', () => syncWakeLock());
			app.addHook('onClose', async () => {
				booted = false;
				for (const stop of stops.splice(0)) stop();
				await recorder.stop();
				await syncWakeLock();
			});
		},
		{ name: NAME, core: CORE, encapsulate: false, network: false }
	);
}

export default recorderPlugin();
