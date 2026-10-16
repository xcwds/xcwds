/**
 * The page entry: hands the app one camera controller as `app.camera`, and keeps it off whenever
 * nobody can be using it:
 *
 * - **Hidden page.** `onHidden` turns a live camera off (`suspend`), and `onVisible` turns it
 *   back on only if it was on then, the app isn't locked and nothing turned it off meanwhile.
 *   Hidden between the shutter and the encoded photo, it waits for the photo first.
 * - **Locked app.** When `app.lock` (from `@xcwds/plugin-lock`, if the app has it) locks, the
 *   camera stops for good: unlocking doesn't turn it back on, a tap on the viewfinder does.
 * - **Closing.** `onClose` stops it.
 * - **Saving a photo.** While `capturing`, an `onBeforeReload` reason holds app updates back, so
 *   an update can't drop a photo between the shutter and its file. Previewing holds nothing.
 *
 * Leaving the page that shows the viewfinder stops the camera too: that's the component's job, on
 * destroy. Imported at prerender too, so it only touches browser globals when a method is called.
 */
import { definePlugin } from '@xcwds/core';
import { createCamera, type Camera, type CameraEnv } from './camera.js';
import { CORE, NAME, resolveOptions, type CameraPluginOptions } from './options.js';

export type {
	Camera,
	CameraState,
	Capabilities,
	CaptureResult,
	Facing,
	Photo,
	Zoom
} from './camera.js';

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-camera`. */
		readonly camera?: Camera;
	}
}

/** What this plugin uses of `app.lock` (from `@xcwds/plugin-lock`, if the app has it). */
type LockLike = {
	readonly state: { readonly locked: boolean };
	subscribe(listener: (state: { readonly locked: boolean }) => void): () => void;
};

/** What a reload would interrupt: the photo between the shutter and its file. */
export const SAVING = 'A photo is being saved.';

/**
 * Makes the plugin with the browser APIs in `env` (tests pass stand-ins); the default export uses
 * the real ones.
 */
export function cameraPlugin(env: CameraEnv = {}) {
	return definePlugin(
		(app, input: CameraPluginOptions) => {
			const camera = createCamera(resolveOptions(input), env);
			app.decorate('camera', camera);

			const lock = () => (app as { lock?: LockLike }).lock;
			let unsubscribe: (() => void) | undefined;

			app.addHook('onBoot', () => {
				// Registered after every plugin, so it finds the lock whichever comes first.
				unsubscribe = lock()?.subscribe((state) => {
					if (state.locked) camera.stop();
				});
			});
			/** Whether the page is hidden, as the last `onHidden`/`onVisible` said. */
			let hidden = false;
			/** Stops waiting for a photo to finish before turning the camera off. */
			let waiting: (() => void) | undefined;
			app.addHook('onHidden', () => {
				hidden = true;
				if (!camera.capturing) return camera.suspend();
				// Stopping the track now would lose the photo just taken: let it finish first,
				// then turn the camera off if the page is still hidden.
				waiting ??= camera.onChange(() => {
					if (camera.capturing) return;
					waiting?.();
					waiting = undefined;
					if (hidden) camera.suspend();
				});
			});
			app.addHook('onVisible', async () => {
				hidden = false;
				// The lock handles `visibilitychange` before these hooks run, so an auto-lock on
				// return has already happened by now. Locked: forget it was on, so unlocking later
				// and coming back can't turn it on either.
				if (lock()?.state.locked) return camera.stop();
				await camera.resume();
			});
			app.addHook('onBeforeReload', () => (camera.capturing ? SAVING : undefined));
			app.addHook('onClose', () => {
				unsubscribe?.();
				unsubscribe = undefined;
				waiting?.();
				waiting = undefined;
				camera.stop();
			});
		},
		{ name: NAME, core: CORE, encapsulate: false, network: false }
	);
}

export default cameraPlugin();
