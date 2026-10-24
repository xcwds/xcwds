/**
 * The page entry: tracks whether the browser is online, for `<OfflineNotice>`, and with `byApp`
 * tells the service worker which apps are on. Imported at prerender too, so it only touches
 * browser globals once the app boots.
 */
import { definePlugin } from '@xcwds/core';
import {
	APPS_MESSAGE,
	CORE,
	NAME,
	resolveOptions,
	type AppsMessage,
	type OfflineOptions
} from './options.js';

/** The part of `@xcwds/plugin-tools`' `app.tools` this entry reads. */
type Apps = {
	apps(): readonly { id: string }[];
	isOn(id: string): boolean;
	subscribe(listener: () => void): () => void;
};

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
	(app, input: OfflineOptions) => {
		const options = resolveOptions(input);
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
			if (options.byApp) stop = both(stop, sendApps());
		});
		/**
		 * Sends the apps that are on to the worker now (settings have loaded by boot), whenever one
		 * is turned on or off, and to each new worker that takes over.
		 */
		function sendApps(): () => void {
			const tools = (app as { tools?: Apps }).tools;
			const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
			if (!tools || !sw) return () => {};
			const send = () => {
				const message: AppsMessage = {
					type: APPS_MESSAGE,
					on: tools
						.apps()
						.filter((a) => tools.isOn(a.id))
						.map((a) => a.id)
				};
				sw.controller?.postMessage(message);
			};
			const unsubscribe = tools.subscribe(send);
			sw.addEventListener('controllerchange', send);
			return () => {
				unsubscribe();
				sw.removeEventListener('controllerchange', send);
			};
		}

		app.addHook('onClose', () => {
			stop?.();
			stop = undefined;
		});
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);

const both =
	(a: (() => void) | undefined, b: () => void): (() => void) =>
	() => {
		a?.();
		b();
	};
