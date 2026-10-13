/**
 * The page entry. On a private page (`private: true` in the route registry):
 *
 * - **Privacy cover.** When the app is hidden, a plain cover (the app's icon on the page's
 *   background, no text) goes over everything, so the app switcher's snapshot doesn't show the
 *   page; it lifts when the app is visible again. It's drawn from the browser's own
 *   `visibilitychange` event rather than the `onHidden` hook, which runs a little later, after
 *   other plugins' hooks. Best effort: browsers don't promise when they take the snapshot.
 * - **Leak hygiene.** Text fields in `<main>` get `spellcheck="false"`, `autocomplete="off"` and
 *   `autocapitalize="off"`, including fields added later; a field that sets one itself keeps it.
 *
 * And the passcode lock (#76): `app.lock` holds its state (see `lock.ts`). While it's locked, an
 * `onNavigate` guard sends locked pages (the private ones, or every page for the whole app) to
 * the unlock screen and remembers, in memory only, where they were going; locking while on one
 * hides it and goes there too. The app locks itself after being hidden for `autoLockMinutes`.
 * Unlocking lives in memory only, so every start is locked.
 *
 * Imported at prerender too, so it only touches browser globals once the app boots.
 */
import { definePlugin, type Route } from '@xcwds/core';
import type { Component } from 'svelte';
import { createLock, lockEntries, type AppLock } from './lock.js';
import {
	CONCEALED,
	CORE,
	DEFAULT_LOCK,
	HYGIENE,
	NAME,
	isPrivate,
	isTextField,
	needsUnlock,
	parseLock,
	resolveOptions,
	type LockOptions,
	type LockSetting
} from './options.js';

export type { AppLock, LockState, TryResult } from './lock.js';

/** `app.lockScreen`: what the unlock screen needs besides `app.lock`. */
export type LockScreen = {
	/** The unlock screen's path (an app path, without the base path). */
	readonly path: string;
	/**
	 * Where to go after unlocking: the page that was asked for (with its query and hash), or `/`.
	 * Forgets it, so it's only used once.
	 */
	next(): string;
};

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-lock`. */
		readonly lock?: AppLock;
		/** From `@xcwds/plugin-lock`. */
		readonly lockScreen?: LockScreen;
	}
	interface Settings {
		/** From `@xcwds/plugin-lock`. */
		lock?: LockSetting;
	}
}

/** What this plugin uses of `app.routes` (from @xcwds/sveltekit). */
type RoutesLike = { get(path: string): { private?: boolean } | undefined };

/** What this plugin uses of `app.settingsPage` (from `@xcwds/plugin-settings`, if present). */
type SettingsPageLike = { control(name: string, component: Component): () => void };

const FIELDS = 'input, textarea';

/** A path as the guard compares it: no trailing slash (but `/` stays `/`). */
const trim = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

export default definePlugin(
	(app, input: LockOptions) => {
		const options = resolveOptions(input);
		app.settings.field('lock', {
			default: DEFAULT_LOCK,
			parse: parseLock,
			label: 'Private pages',
			section: 'privacy',
			control: {
				type: 'switches',
				options: [
					{
						key: 'cover',
						label: 'Cover private pages in the app switcher',
						// One line for both protections (a switches field shows only its options).
						hint: "Best effort: browsers don't promise when they take the snapshot. Typing on private pages never uses spellcheck or autocomplete."
					}
				]
			}
		});

		const setting = (): LockSetting => app.settings.get().lock ?? DEFAULT_LOCK;
		const routes = () => (app as { routes?: RoutesLike }).routes;
		const isUnlock = (path: string) => trim(path) === options.unlock;
		/** Whether a locked app keeps `path` behind the unlock screen. */
		const locks = (path: string) => needsUnlock(routes(), path, setting().scope, options.unlock);

		// Read now: the kernel hands plugins the device's storage before they register (and an
		// in-memory one at prerender, where no passcode is ever set).
		const { lock, stop: stopLock } = createLock(app.storage, lockEntries(app.storage), {
			locks,
			here: () => current?.path
		});
		app.decorate('lock', lock satisfies AppLock);

		/** Where a locked navigation was going, for after unlocking. In memory, never in the URL. */
		let target: string | null = null;
		app.decorate('lockScreen', {
			path: options.unlock,
			next() {
				const next = target ?? '/';
				target = null;
				return next;
			}
		} satisfies LockScreen);

		/** A route as the guard remembers it: its path with the query and hash. */
		const full = (to: Route) => to.path + (to.url ? to.url.search + to.url.hash : '');
		/** The page showing now (from `afterNavigate`). */
		let current: Route | null = null;
		/** When the app was hidden while unlocked, for auto-lock (ms since the epoch). */
		let hiddenAt: number | null = null;

		app.addHook('onNavigate', (to) => {
			// Nothing to unlock (any more): on to the page that was asked for.
			if (isUnlock(to.path)) return lock.state.locked ? undefined : app.lockScreen!.next();
			if (!lock.state.locked || !locks(to.path)) return undefined;
			target = full(to);
			return options.unlock;
		});

		/** Hides the whole page (the head script does the same before first paint). */
		function conceal() {
			const root = document.documentElement;
			root.setAttribute(CONCEALED, '');
			root.style.setProperty('visibility', 'hidden', 'important');
		}

		function reveal() {
			const root = document.documentElement;
			if (!root.hasAttribute(CONCEALED)) return;
			root.removeAttribute(CONCEALED);
			root.style.removeProperty('visibility');
		}

		/** Locked while on a locked page: hide it and show the unlock screen in its place. */
		function lockedHere() {
			if (!current || !locks(current.path)) return;
			target = full(current);
			conceal();
			void import('./navigate.js')
				.then(({ go }) => go(options.unlock, true))
				.catch((error: unknown) => app.reportError(error));
		}

		let onPrivate = false;
		let cover: HTMLElement | null = null;
		/** Whether the cover is up (it waits on private pages, out of sight, until it's needed). */
		let shown = false;
		let observer: MutationObserver | null = null;
		/** Attributes this plugin set, per field, so leaving the page can take them off again. */
		let touched = new Map<Element, string[]>();
		let stops: (() => void)[] = [];
		let closed = false;

		const coverWanted = () => (app.settings.get().lock ?? DEFAULT_LOCK).cover;

		/** The app's icon, as the head links it (the base path is already in its URL). */
		const iconUrl = () =>
			document.querySelector<HTMLLinkElement>('link[rel~="icon"][type="image/svg+xml"]')?.href ??
			document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.href;

		/** Made ahead of time on a private page, so its icon has loaded when it's needed. */
		function makeCover() {
			if (cover) return;
			cover = document.createElement('div');
			cover.dataset.xcwdsCover = '';
			cover.setAttribute('aria-hidden', 'true');
			// Inline styles: no stylesheet to load, and no transition (reduced motion, and the
			// snapshot can't wait for a fade). Shown and hidden with `display`, not the `hidden`
			// attribute, which an inline `display` would override.
			cover.style.cssText =
				'position:fixed;inset:0;z-index:2147483647;display:none;place-items:center;background:Canvas;';
			const src = iconUrl();
			if (src) {
				const img = document.createElement('img');
				img.src = src;
				img.alt = '';
				img.width = img.height = 96;
				cover.append(img);
			}
			document.body.append(cover);
		}

		function setShown(value: boolean) {
			shown = value;
			if (cover) cover.style.display = value ? 'grid' : 'none';
		}

		function removeCover() {
			cover?.remove();
			cover = null;
			shown = false;
		}

		/** The page's own background, so the cover matches the light or dark scheme. */
		function background() {
			for (const el of [document.body, document.documentElement]) {
				const color = getComputedStyle(el).backgroundColor;
				if (color && color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color)) return color;
			}
			return 'Canvas';
		}

		function onVisibility() {
			if (document.visibilityState === 'hidden') {
				if (lock.state.enabled && !lock.state.locked) {
					if (setting().autoLockMinutes === 0) lock.lock();
					else hiddenAt = Date.now();
				}
				if (!onPrivate || !coverWanted()) return;
				makeCover();
				cover!.style.background = background();
				setShown(true);
			} else {
				const minutes = setting().autoLockMinutes;
				// Locked before the cover lifts, so the page is already hidden when it does.
				if (hiddenAt !== null && Date.now() - hiddenAt >= minutes * 60_000) lock.lock();
				hiddenAt = null;
				if (!cover) return;
				setShown(false);
				if (!onPrivate) removeCover();
			}
		}

		function protect(field: Element) {
			if (!isTextField(field.tagName, field.getAttribute('type')) || !field.closest('main')) return;
			const set: string[] = touched.get(field) ?? [];
			for (const [name, value] of Object.entries(HYGIENE)) {
				if (field.hasAttribute(name)) continue;
				field.setAttribute(name, value);
				set.push(name);
			}
			if (set.length) touched.set(field, set);
		}

		function protectAll(root: ParentNode) {
			if (root instanceof Element && root.matches(FIELDS)) protect(root);
			root.querySelectorAll(FIELDS).forEach(protect);
		}

		function enter() {
			protectAll(document);
			if (!observer) {
				observer = new MutationObserver((records) => {
					for (const record of records)
						for (const node of record.addedNodes) if (node instanceof Element) protectAll(node);
				});
				observer.observe(document.body, { childList: true, subtree: true });
			}
			makeCover();
		}

		function leave() {
			observer?.disconnect();
			observer = null;
			// A field that outlives the page (the same component on another path) gets its own
			// attributes back.
			for (const [field, names] of touched)
				for (const name of names)
					if (field.getAttribute(name) === HYGIENE[name]) field.removeAttribute(name);
			touched = new Map();
			if (!shown) removeCover();
		}

		app.addHook('afterNavigate', (to) => {
			// A locked page that still showed (the first page, before the guards ran) stays hidden
			// until the unlock screen replaces it; anything else shows. Having gone somewhere else
			// instead of unlocking, the page asked for earlier isn't wanted any more.
			const hide = lock.state.locked && locks(to.path);
			if (!hide && !isUnlock(to.path)) target = null;
			current = to;
			if (typeof document === 'undefined') return;
			if (hide) conceal();
			else reveal();
			const next = isPrivate(routes(), to.path);
			if (next) enter();
			else if (onPrivate) leave();
			onPrivate = next;
		});

		app.addHook('onBoot', () => {
			// Booted without a page (a unit test in Node): nothing to cover.
			if (typeof document === 'undefined') return;
			document.addEventListener('visibilitychange', onVisibility);
			stops.push(() => document.removeEventListener('visibilitychange', onVisibility));
			let wasLocked = lock.state.locked;
			stops.push(
				lock.subscribe((state) => {
					if (state.locked && !wasLocked) lockedHere();
					wasLocked = state.locked;
				})
			);
			// With @xcwds/plugin-settings, Settings → Privacy shows the lock's controls. Loaded
			// lazily: the component imports @xcwds/sveltekit, which imports this entry.
			const page = (app as { settingsPage?: SettingsPageLike }).settingsPage;
			if (page)
				void import('./LockSettings.svelte').then(({ default: LockSettings }) => {
					if (!closed) stops.push(page.control('lock', LockSettings));
				});
		});

		app.addHook('onClose', () => {
			closed = true;
			if (typeof document !== 'undefined') reveal();
			if (onPrivate) leave();
			onPrivate = false;
			removeCover();
			for (const stop of stops) stop();
			stops = [];
			stopLock();
		});
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
