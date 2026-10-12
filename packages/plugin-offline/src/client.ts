/**
 * The page entry: tracks whether the browser is online, for `<OfflineNotice>`. Imported at
 * prerender too, so it only touches browser globals once the app boots.
 */
import { definePlugin } from '@xcwds/core';
import { CORE, NAME, type OfflineOptions } from './options.js';

/** Whether the browser is online, as `app.network`. */
export type NetworkStatus = {
	/** `navigator.onLine` (`true` until the app boots, e.g. while prerendering). */
	readonly online: boolean;
	/** Calls `listener` now and whenever it changes; returns a function that stops it. */
	subscribe(listener: (online: boolean) => void): () => void;
};

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-offline`. */
		readonly network?: NetworkStatus;
	}
}

export default definePlugin(
	(app, _options: OfflineOptions) => {
		let online = true;
		const listeners = new Set<(online: boolean) => void>();
		const set = (value: boolean) => {
			if (value === online) return;
			online = value;
			for (const listener of listeners) listener(value);
		};
		const status: NetworkStatus = {
			get online() {
				return online;
			},
			subscribe(listener) {
				listeners.add(listener);
				listener(online);
				return () => void listeners.delete(listener);
			}
		};
		app.decorate('network', status);

		const goOnline = () => set(true);
		const goOffline = () => set(false);
		let stop: (() => void) | undefined;
		app.addHook('onBoot', () => {
			const win = window;
			win.addEventListener('online', goOnline);
			win.addEventListener('offline', goOffline);
			stop = () => {
				win.removeEventListener('online', goOnline);
				win.removeEventListener('offline', goOffline);
			};
			set(navigator.onLine);
		});
		app.addHook('onClose', () => {
			stop?.();
			stop = undefined;
		});
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
