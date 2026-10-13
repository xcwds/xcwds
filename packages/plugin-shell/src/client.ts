/**
 * The page entry. Adds the `nav` setting (applied before first paint), toasts (`app.toast`, which
 * also report failed saves) and `app.shell`: the sections from the config and the places other
 * plugins add components to (Home blocks and header actions).
 *
 * Imported at prerender too, so it only touches browser globals once the app boots.
 */
import { definePlugin } from '@xcwds/core';
import type { Component } from 'svelte';
import {
	APPLY_NAV,
	DEFAULT_NAV,
	CORE,
	NAME,
	applyNav,
	parseNav,
	resolveOptions,
	type NavSetting,
	type Section,
	type ShellOptions
} from './options.js';

/** A link shown with a toast: an app path, plus an optional `#hash`. */
export type ToastAction = { label: string; path: string; hash?: string };
export type Toast = {
	id: number;
	message: string;
	action?: ToastAction;
	/** The page it was raised on (an app path), so a locked app can hide what it says. */
	path?: string;
};
export type ToastOptions = {
	action?: ToastAction;
	/** How long it shows. Defaults to 3 s, or 8 s with an action (so it can be tapped). */
	durationMs?: number;
};

/** A component a plugin adds to the shell, in `order` (lowest first, then as added). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Slot = { component: Component<any>; props?: Record<string, unknown>; order: number };

type SlotList = {
	/** Adds a component; returns a function that removes it. */
	add(
		component: Slot['component'],
		options?: { props?: Record<string, unknown>; order?: number }
	): () => void;
	list(): readonly Slot[];
	/** Calls `listener` now and on every change; returns a function that stops it. */
	subscribe(listener: (slots: readonly Slot[]) => void): () => void;
};

/** `app.shell`. */
export type AppShell = {
	readonly sections: readonly Section[];
	/** Blocks on the Home page (`/`), e.g. pinned and recent tools. */
	readonly home: SlotList;
	/** Buttons in the header beside the title, e.g. Share. */
	readonly header: SlotList;
	/** The toasts showing now; `subscribe` to follow them. */
	readonly toasts: {
		list(): readonly Toast[];
		subscribe(listener: (toasts: readonly Toast[]) => void): () => void;
		dismiss(id: number): void;
	};
};

declare module '@xcwds/core' {
	interface Settings {
		/** From `@xcwds/plugin-shell`: header links or a sidebar on wider screens, per orientation. */
		nav: NavSetting;
	}
	interface App {
		/** From `@xcwds/plugin-shell`. */
		readonly shell?: AppShell;
		/** From `@xcwds/plugin-shell`: shows a short confirmation in the notification stack. */
		readonly toast?: (message: string, options?: ToastOptions) => void;
	}
}

/** What the shell says when something couldn't be saved (`app.storage.onSaveFailure`). */
export const SAVE_FAILED =
	"Couldn't save on this device: storage is full or blocked. Download a backup from Settings.";

/** What this plugin uses of `app.settingsPage` (from `@xcwds/plugin-settings`, if present). */
type SettingsPageLike = { control(name: string, component: Component): () => void };

/** At most this many toasts show at once; older ones go first. */
const MAX_TOASTS = 3;

function slotList(): SlotList {
	let slots: Slot[] = [];
	const listeners = new Set<(slots: readonly Slot[]) => void>();
	const changed = () => {
		for (const listener of listeners) listener(slots);
	};
	return {
		add(component, { props, order = 0 } = {}) {
			const slot: Slot = { component, ...(props ? { props } : {}), order };
			// Stable: equal orders keep the order they were added in.
			slots = [...slots, slot].sort((a, b) => a.order - b.order);
			changed();
			return () => {
				slots = slots.filter((s) => s !== slot);
				changed();
			};
		},
		list: () => slots,
		subscribe(listener) {
			listeners.add(listener);
			listener(slots);
			return () => void listeners.delete(listener);
		}
	};
}

export default definePlugin(
	(app, input: ShellOptions) => {
		const options = resolveOptions(input);
		app.settings.field('nav', {
			default: DEFAULT_NAV,
			parse: parseNav,
			label: 'Navigation',
			section: 'appearance',
			prePaint: APPLY_NAV
		});

		let toasts: Toast[] = [];
		const timers = new Map<number, ReturnType<typeof setTimeout>>();
		const toastListeners = new Set<(toasts: readonly Toast[]) => void>();
		const setToasts = (next: Toast[]) => {
			toasts = next;
			for (const listener of toastListeners) listener(toasts);
		};
		let nextId = 1;
		const dismiss = (id: number) => {
			clearTimeout(timers.get(id));
			timers.delete(id);
			if (toasts.some((t) => t.id === id)) setToasts(toasts.filter((t) => t.id !== id));
		};

		app.decorate('shell', {
			sections: options.sections,
			home: slotList(),
			header: slotList(),
			toasts: {
				list: () => toasts,
				subscribe(listener) {
					toastListeners.add(listener);
					listener(toasts);
					return () => void toastListeners.delete(listener);
				},
				dismiss
			}
		} satisfies AppShell);
		/**
		 * The page showing now, which toasts record. `@xcwds/plugin-lock` follows every page, even
		 * with this plugin under a route prefix (whose route hooks only see paths below it).
		 */
		let seen: string | undefined;
		app.addHook('afterNavigate', (to) => void (seen = to.path));
		const lock = () => (app as { lock?: { here(): string | undefined } }).lock;
		const here = () => lock()?.here() ?? seen;
		const toast = (message: string, { action, durationMs }: ToastOptions = {}) => {
			const id = nextId++;
			const path = here();
			const next = [
				...toasts,
				{
					id,
					message,
					...(action ? { action } : {}),
					...(path === undefined ? {} : { path })
				}
			];
			for (const old of next.splice(0, Math.max(0, next.length - MAX_TOASTS))) {
				clearTimeout(timers.get(old.id));
				timers.delete(old.id);
			}
			setToasts(next);
			timers.set(
				id,
				setTimeout(() => dismiss(id), durationMs ?? (action ? 8000 : 3000))
			);
		};
		app.decorate('toast', toast);

		let stops: (() => void)[] = [];
		let closed = false;
		app.addHook('onBoot', () => {
			const root = document.documentElement;
			const apply = () => applyNav(app.settings.get().nav, root);
			apply();
			stops.push(app.settings.subscribe(apply));
			// A failed save is reported once per entry (every time for an action that confirms it),
			// and never stacked.
			stops.push(
				app.storage.onSaveFailure(() => {
					if (!toasts.some((t) => t.message === SAVE_FAILED))
						toast(SAVE_FAILED, { durationMs: 6000 });
				})
			);
			// With @xcwds/plugin-settings, the settings page shows the nav setting with NavPicker.
			// Loaded lazily: the component imports @xcwds/sveltekit, which imports this entry.
			const page = (app as { settingsPage?: SettingsPageLike }).settingsPage;
			if (page)
				void import('./NavPicker.svelte').then(({ default: NavPicker }) => {
					if (!closed) stops.push(page.control('nav', NavPicker));
				});
		});
		app.addHook('onClose', () => {
			closed = true;
			for (const stop of stops) stop();
			stops = [];
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
		});
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
