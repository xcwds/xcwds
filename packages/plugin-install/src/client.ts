/**
 * The page entry, ported from xcwds.github.io's `install.svelte.ts`. Chromium browsers fire
 * `beforeinstallprompt` when the app can be installed; it is kept (the head script catches one
 * that fires before the app starts) and shown from a tap with `app.install.prompt()`. iPhone and
 * iPad have no prompt, so `ios` says to show Add to Home Screen steps instead. Once the app
 * runs installed (standalone), there is nothing to offer.
 *
 * Imported at prerender too, so it only touches browser globals once the app boots.
 */
import { definePlugin } from '@xcwds/core';
import type { Component } from 'svelte';
import {
	CORE,
	NAME,
	PROMPT_GLOBAL,
	isIos,
	isStandalone,
	resolveOptions,
	type InstallOptions
} from './options.js';

/** What this plugin uses of `app.settingsPage` (from `@xcwds/plugin-settings`, if present). */
type SettingsPageLike = {
	add(component: Component, options?: { order?: number }): () => void;
};

/** Chromium's install prompt event (not in TypeScript's DOM types). */
type BeforeInstallPromptEvent = Event & {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export type InstallState = {
	/** The checks below have run (a prerendered page can't know, so show nothing until then). */
	readonly checked: boolean;
	/** Running as the installed app, not in a browser tab. */
	readonly installed: boolean;
	/** The browser offered an install prompt that `prompt()` can show. */
	readonly available: boolean;
	/** iPhone or iPad: no prompt, so show Add to Home Screen steps. */
	readonly ios: boolean;
};

/** `app.install`. */
export type AppInstall = {
	readonly state: InstallState;
	/** Calls `listener` now and on every change; returns a function that stops it. */
	subscribe(listener: (state: InstallState) => void): () => void;
	/**
	 * Shows the browser's install dialog (call it from a tap); resolves to what the user chose,
	 * or `'unavailable'` when there is no prompt or the browser refused to show it.
	 */
	prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
};

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-install`. */
		readonly install?: AppInstall;
	}
}

export default definePlugin(
	(app, input: InstallOptions) => {
		resolveOptions(input);
		let state: InstallState = { checked: false, installed: false, available: false, ios: false };
		const listeners = new Set<(state: InstallState) => void>();
		const set = (patch: Partial<InstallState>) => {
			state = { ...state, ...patch };
			for (const listener of listeners) listener(state);
		};
		let deferred: BeforeInstallPromptEvent | null = null;
		let stops: (() => void)[] = [];
		let booted = false;

		app.decorate('install', {
			get state() {
				return state;
			},
			subscribe(listener) {
				listeners.add(listener);
				listener(state);
				return () => void listeners.delete(listener);
			},
			async prompt() {
				const event = deferred;
				if (!event) return 'unavailable';
				// A prompt can be shown once.
				deferred = null;
				set({ available: false });
				try {
					await event.prompt();
				} catch {
					// Not shown (no user gesture): keep it for the next tap, unless a newer one came.
					if (!deferred && !state.installed) {
						deferred = event;
						set({ available: true });
					}
					return 'unavailable';
				}
				const { outcome } = await event.userChoice;
				if (outcome === 'accepted') set({ installed: true });
				return outcome;
			}
		} satisfies AppInstall);

		app.addHook('onBoot', () => {
			booted = true;
			const win = window as Window & { [PROMPT_GLOBAL]?: BeforeInstallPromptEvent };
			const display = win.matchMedia?.('(display-mode: standalone)');
			const standalone = () =>
				isStandalone(
					!!display?.matches,
					(navigator as Navigator & { standalone?: unknown }).standalone
				);
			const capture = (event: Event) => {
				event.preventDefault();
				deferred = event as BeforeInstallPromptEvent;
				set({ available: !state.installed });
			};
			const installed = () => {
				deferred = null;
				set({ installed: true, available: false });
			};
			const displayChanged = () => {
				if (standalone()) installed();
			};
			set({
				checked: true,
				installed: standalone(),
				ios: isIos(navigator.userAgent, navigator.maxTouchPoints ?? 0)
			});
			const early = win[PROMPT_GLOBAL];
			if (early) {
				delete win[PROMPT_GLOBAL];
				capture(early);
			}
			win.addEventListener('beforeinstallprompt', capture);
			win.addEventListener('appinstalled', installed);
			display?.addEventListener('change', displayChanged);
			// With @xcwds/plugin-settings, the install card leads the settings page. Loaded lazily:
			// the component imports @xcwds/sveltekit, which imports this entry.
			const page = (app as { settingsPage?: SettingsPageLike }).settingsPage;
			if (page)
				void import('./InstallCard.svelte').then(({ default: InstallCard }) => {
					if (booted) stops.push(page.add(InstallCard, { order: -100 }));
				});
			stops = [
				...stops,
				() => win.removeEventListener('beforeinstallprompt', capture),
				() => win.removeEventListener('appinstalled', installed),
				() => display?.removeEventListener('change', displayChanged)
			];
		});
		app.addHook('onClose', () => {
			booted = false;
			for (const stop of stops) stop();
			stops = [];
		});
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
