/**
 * The page entry: tracks whether the browser is online, for `<OfflineNotice>`, and with `byApp`
 * tells the service worker which apps are on and asks it what each keeps offline
 * (`app.offline`). Imported at prerender too, so it only touches browser globals once the app
 * boots (or `usage()` is called).
 */
import { definePlugin } from '@xcwds/core';
import {
	APPS_MESSAGE,
	CORE,
	NAME,
	USAGE_MESSAGE,
	resolveOptions,
	type AppUsage,
	type AppsMessage,
	type OfflineOptions,
	type UsageMessage
} from './options.js';

export type { AppUsage } from './options.js';

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

/** What the app keeps on the device, as `app.offline.usage()` answers it. */
export type OfflineUsage = {
	/**
	 * What each app keeps offline, in the apps' order; undefined when no worker controls the page
	 * or it didn't answer in time.
	 */
	apps: AppUsage[] | undefined;
	/**
	 * Everything the app stores on this device, offline copies and saved data alike, as the
	 * browser estimates it (`navigator.storage.estimate()`); undefined where it can't say.
	 */
	storage: { usage: number; quota: number } | undefined;
};

/** With `byApp`, as `app.offline`. */
export type OfflineApps = {
	/** Asks the worker what each app keeps offline, and the browser how much is stored. */
	usage(): Promise<OfflineUsage>;
};

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-offline`. */
		readonly network?: NetworkStatus;
		/** From `@xcwds/plugin-offline`, with `byApp`. */
		readonly offline?: OfflineApps;
	}
}

/** How long `usage()` waits for the worker to answer. */
const USAGE_TIMEOUT = 5000;

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
		if (options.byApp) app.decorate('offline', { usage } satisfies OfflineApps);

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

async function usage(): Promise<OfflineUsage> {
	// After the rest of the current task: when an app was just turned on or off, the apps message
	// this entry sends for it reaches the worker first, so the answer counts its pages.
	await Promise.resolve();
	const [apps, storage] = await Promise.all([askWorker(), estimate()]);
	return { apps, storage };
}

/** The worker's answer to `USAGE_MESSAGE`, or undefined without one in time. */
function askWorker(): Promise<AppUsage[] | undefined> {
	const controller =
		typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : undefined;
	if (!controller || typeof MessageChannel === 'undefined') return Promise.resolve(undefined);
	const { port1, port2 } = new MessageChannel();
	return new Promise((resolve) => {
		const done = (answer: AppUsage[] | undefined) => {
			clearTimeout(timer);
			port1.close();
			resolve(answer);
		};
		const timer = setTimeout(() => done(undefined), USAGE_TIMEOUT);
		port1.onmessage = (event: MessageEvent) =>
			done(Array.isArray(event.data) ? (event.data as AppUsage[]) : undefined);
		const message: UsageMessage = { type: USAGE_MESSAGE, port: port2 };
		controller.postMessage(message, [port2]);
	});
}

async function estimate(): Promise<OfflineUsage['storage']> {
	try {
		const found = await navigator.storage?.estimate?.();
		return typeof found?.usage === 'number' && typeof found.quota === 'number'
			? { usage: found.usage, quota: found.quota }
			: undefined;
	} catch {
		return undefined;
	}
}

const both =
	(a: (() => void) | undefined, b: () => void): (() => void) =>
	() => {
		a?.();
		b();
	};
