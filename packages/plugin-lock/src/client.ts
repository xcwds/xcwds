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
 * And `app.lock`, the passcode lock's state (#76, see `lock.ts`): set up, unlock, lock, change,
 * turn off and reset. Unlocking lives in memory only, so every start is locked.
 *
 * Imported at prerender too, so it only touches browser globals once the app boots.
 */
import { definePlugin } from '@xcwds/core';
import { createLock, lockEntries, type AppLock } from './lock.js';
import {
	CORE,
	DEFAULT_LOCK,
	HYGIENE,
	NAME,
	isPrivate,
	isTextField,
	parseLock,
	resolveOptions,
	type LockOptions,
	type LockSetting
} from './options.js';

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-lock`. */
		readonly lock?: AppLock;
	}
	interface Settings {
		/** From `@xcwds/plugin-lock`. */
		lock?: LockSetting;
	}
}

/** What this plugin uses of `app.routes` (from @xcwds/sveltekit). */
type RoutesLike = { get(path: string): { private?: boolean } | undefined };

const FIELDS = 'input, textarea';

export default definePlugin(
	(app, input: LockOptions) => {
		resolveOptions(input);
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

		// Read now: the kernel hands plugins the device's storage before they register (and an
		// in-memory one at prerender, where no passcode is ever set).
		const { lock, stop: stopLock } = createLock(app.storage, lockEntries(app.storage));
		app.decorate('lock', lock satisfies AppLock);

		let onPrivate = false;
		let cover: HTMLElement | null = null;
		/** Whether the cover is up (it waits on private pages, out of sight, until it's needed). */
		let shown = false;
		let observer: MutationObserver | null = null;
		/** Attributes this plugin set, per field, so leaving the page can take them off again. */
		let touched = new Map<Element, string[]>();
		let stops: (() => void)[] = [];

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
				if (!onPrivate || !coverWanted()) return;
				makeCover();
				cover!.style.background = background();
				setShown(true);
			} else if (cover) {
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
			if (typeof document === 'undefined') return;
			const routes = (app as { routes?: RoutesLike }).routes;
			const next = isPrivate(routes, to.path);
			if (next) enter();
			else if (onPrivate) leave();
			onPrivate = next;
		});

		app.addHook('onBoot', () => {
			// Booted without a page (a unit test in Node): nothing to cover.
			if (typeof document === 'undefined') return;
			document.addEventListener('visibilitychange', onVisibility);
			stops.push(() => document.removeEventListener('visibilitychange', onVisibility));
		});

		app.addHook('onClose', () => {
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
