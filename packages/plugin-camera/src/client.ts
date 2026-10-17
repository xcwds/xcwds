/**
 * The page entry: hands the app one camera controller as `app.camera`, and keeps it off whenever
 * nobody can be using it:
 *
 * - **Hidden page.** `onHidden` turns a live camera off (`suspend`), and `onVisible` turns it
 *   back on only if it was on then, the app isn't locked and nothing turned it off meanwhile.
 *   Hidden or locked between the shutter and the encoded photo, it lets the photo finish first.
 * - **Locked app.** When `app.lock` (from `@xcwds/plugin-lock`, if the app has it) locks, the
 *   camera stops for good: unlocking doesn't turn it back on, a tap on the viewfinder does.
 * - **Closing.** `onClose` stops it.
 * - **Keeping photos.** `app.photos` saves them in the app's blob store (`app:camera:photos`,
 *   group `photos`), each with a small thumbnail (`app:camera:photos-thumbs`), out of backups.
 * - **Saving a photo.** While `capturing`, an `onBeforeReload` reason holds app updates back, so
 *   an update can't drop a photo between the shutter and its file. Previewing holds nothing.
 *
 * Leaving the page that shows the viewfinder stops the camera too: that's the component's job, on
 * destroy. Imported at prerender too, so it only touches browser globals when a method is called.
 */
import { definePlugin } from '@xcwds/core';
import { createCamera, type Camera, type CameraEnv } from './camera.js';
import { CORE, NAME, resolveOptions, type CameraPluginOptions } from './options.js';
import { createPhotos, type Photos } from './photos.js';

export type {
	Camera,
	CameraState,
	Capabilities,
	CaptureResult,
	Facing,
	Photo,
	Zoom
} from './camera.js';
export type { Photos, SavedPhoto, SaveResult, PhotoInput } from './photos.js';

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-camera`. */
		readonly camera?: Camera;
		/** From `@xcwds/plugin-camera`: the photos kept in the app (`app:camera:photos`). */
		readonly photos?: Photos;
	}
}

/** What this plugin uses of `app.lock` (from `@xcwds/plugin-lock`, if the app has it). */
type LockLike = {
	readonly state: { readonly locked: boolean };
	subscribe(listener: (state: { readonly locked: boolean }) => void): () => void;
};

/**
 * What a reload would interrupt: the photo between the shutter and its file. A noun phrase, as
 * plugin-update's banner says "Reloading now will interrupt your {busy}".
 */
export const SAVING = 'photo being saved';

/**
 * Makes the plugin with the browser APIs in `env` (tests pass stand-ins); the default export uses
 * the real ones.
 */
export function cameraPlugin(env: CameraEnv = {}) {
	return definePlugin(
		(app, input: CameraPluginOptions) => {
			const options = resolveOptions(input);
			const camera = createCamera(options, env);
			app.decorate('camera', camera);
			// Photos kept in the app: personal (a lock's reset clears them), never in backups.
			// Picked files are re-encoded like the camera's own photos.
			const { maxSide, type, quality } = options;
			app.decorate('photos', createPhotos(app.blobs, { image: { maxSide, type, quality } }, env));

			const lock = () => (app as { lock?: LockLike }).lock;
			let unsubscribe: (() => void) | undefined;

			/**
			 * What to do once the photo being taken is encoded: stopping the track mid-capture
			 * would lose it. `stop` (locked) wins over `suspend` (hidden), so a later hide can't
			 * turn a lock's stop into something a return would undo.
			 */
			let pending: 'suspend' | 'stop' | undefined;
			let waiting: (() => void) | undefined;
			const cancel = () => {
				waiting?.();
				waiting = undefined;
				pending = undefined;
			};
			const turnOff = (how: 'suspend' | 'stop') => {
				if (!camera.capturing) {
					cancel();
					return camera[how]();
				}
				if (pending !== 'stop') pending = how;
				waiting ??= camera.onChange(() => {
					if (camera.capturing) return;
					const next = pending;
					cancel();
					if (next) camera[next]();
				});
			};

			app.addHook('onBoot', () => {
				// Registered after every plugin, so it finds the lock whichever comes first.
				unsubscribe = lock()?.subscribe((state) => {
					if (state.locked) turnOff('stop');
				});
			});
			app.addHook('onHidden', () => turnOff('suspend'));
			app.addHook('onVisible', async () => {
				// The lock handles `visibilitychange` before these hooks run, so an auto-lock on
				// return has already happened by now. Locked: forget it was on, so unlocking later
				// and coming back can't turn it on either.
				if (lock()?.state.locked) return turnOff('stop');
				// Back before the photo was done: it stays on.
				if (pending === 'suspend') cancel();
				await camera.resume();
			});
			app.addHook('onBeforeReload', () => (camera.capturing ? SAVING : undefined));
			app.addHook('onClose', () => {
				unsubscribe?.();
				unsubscribe = undefined;
				cancel();
				camera.stop();
			});
		},
		{ name: NAME, core: CORE, encapsulate: false, network: false }
	);
}

export default cameraPlugin();
