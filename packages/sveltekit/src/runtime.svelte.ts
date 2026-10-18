/**
 * The app in the page bundle: one kernel app per page load (and per prerender process), built
 * from the plugins' `./client` entries that the Vite plugin lists in `virtual:xcwds/client`.
 */
import { browser } from '$app/env';
import { memoryStorage, type App } from '@xcwds/core';
import { data, plugins } from 'virtual:xcwds/client';
import { setupApp } from './routes.js';

type Runtime = { app: App; loading: Promise<App> | null };

let runtime: Runtime | null = null;
let loaded = $state(false);

/**
 * The app, created on first use with every client plugin registered. Its plugins load with
 * `loadApp()`: `handle` and the `init` hooks do that before anything renders.
 */
export function getApp(): App {
	if (!runtime) {
		const app = setupApp({
			name: data.name,
			storagePrefix: data.storagePrefix,
			appName: data.backupApp,
			routes: data.routes,
			plugins,
			// Prerendering has no storage: pages render with defaults, and the browser loads the
			// saved values after mount so hydration matches.
			storage: browser ? undefined : memoryStorage()
		});
		runtime = { app, loading: null };
	}
	return runtime.app;
}

/** Loads every plugin once; resolves to the app. */
export function loadApp(): Promise<App> {
	const app = getApp();
	const r = runtime!;
	r.loading ??= app.load().then(() => {
		if (runtime === r) loaded = true;
		return app;
	});
	return r.loading;
}

/** Whether the plugins have loaded (reactive). */
export function appLoaded(): boolean {
	return loaded;
}

/** Runs `fn` now if the plugins have loaded, or once they have. */
export function whenLoaded(fn: (app: App) => void): void {
	if (loaded) fn(getApp());
	else void loadApp().then(fn);
}

// Vite HMR replaced this module: close the old app so its listeners don't stack (decision 8).
if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		const old = runtime?.app;
		runtime = null;
		loaded = false;
		void old?.close();
	});
}
