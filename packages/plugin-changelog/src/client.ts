/**
 * The page entry, ported from xcwds.github.io's `changelog.ts` and the What's new section in
 * Settings. It saves the newest entry the user has seen (`app:changelog:seen`). A fresh install
 * saves nothing and badges nothing: everything so far counts as seen. Each version hands its
 * newest entry to the next through `@xcwds/plugin-update` (`carry`), so after an update the
 * entries the user hasn't seen get a badge and a toast links to What's new, which
 * `@xcwds/plugin-settings` shows on its page; with nothing new, the toast just says it updated.
 *
 * Imported at prerender too, so it only touches browser globals once the app boots.
 */
import { definePlugin } from '@xcwds/core';
import type { Component } from 'svelte';
import {
	CORE,
	NAME,
	latestId,
	resolveOptions,
	type ChangelogEntry,
	type ChangelogOptions
} from './options.js';

/** What this plugin uses of `app.settingsPage` (from `@xcwds/plugin-settings`, if present). */
type SettingsPageLike = {
	readonly options: { path: string };
	add(component: Component, options?: { order?: number }): () => void;
};
/** What this plugin uses of `app.update` (from `@xcwds/plugin-update`, if present). */
type UpdateLike = {
	carry(name: string, value: () => unknown): () => void;
	handover(): Readonly<Record<string, unknown>> | null;
};
/** What this plugin uses of `app.toast` (from `@xcwds/plugin-shell`, if present). */
type ToastLike = (
	message: string,
	options?: { action?: { label: string; path: string; hash?: string } }
) => void;

/** The name this plugin carries its newest entry under (`app.update.carry`). */
const CARRIED = 'changelog';

/** The element id of the What's new section, for links to it. */
export const SECTION_ID = 'whats-new';

/** `app.changelog`. */
export type AppChangelog = {
	/** The entries What's new lists (the newest `show`), newest first. */
	readonly entries: readonly ChangelogEntry[];
	/** The newest entry's id, or 0. */
	readonly latest: number;
	/** The newest entry id the user has seen; entries above it are new. */
	seen(): number;
	/** Marks every entry seen (What's new does when it shows). */
	markSeen(): void;
	/** Calls `listener` now and whenever `seen()` changes; returns a function that stops it. */
	subscribe(listener: (seen: number) => void): () => void;
};

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-changelog`. */
		readonly changelog?: AppChangelog;
	}
}

const parseSeen = (v: unknown) =>
	typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;

export default definePlugin(
	(app, input: ChangelogOptions) => {
		const options = resolveOptions(input);
		const latest = latestId(options.entries);
		const entry = app.storage.entry('seen', {
			label: "What's new",
			parse: parseSeen,
			...(options.storageKey ? { key: options.storageKey } : {})
		});
		// Until the browser reads the saved value, nothing is new (so prerendered pages badge nothing).
		let seen = latest;
		const listeners = new Set<(seen: number) => void>();
		const set = (next: number) => {
			if (next === seen) return;
			seen = next;
			for (const listener of listeners) listener(seen);
		};
		/** Read on the first use in the browser: boot, or a What's new that mounts before it. */
		let started = false;
		/** On the first load after an update: whether it brought entries the user hadn't seen. */
		let news: boolean | null = null;
		const update = () => (app as { update?: UpdateLike }).update;
		/**
		 * Reads the saved marker. Nothing saved means everything so far counts as seen, and a
		 * fresh install saves nothing. After an update, what the previous version had becomes the
		 * marker, so the entries since then show as new.
		 */
		function start() {
			if (started) return;
			started = true;
			const saved = app.storage.read(entry);
			const handed = update()?.handover?.() ?? null;
			if (!handed) return set(saved ?? latest);
			// A version that carried nothing (older than this plugin): the newest entry is new.
			const previous = Number.isSafeInteger(handed[CARRIED])
				? (handed[CARRIED] as number)
				: latest - 1;
			const since = Math.min(previous, saved ?? previous);
			news = since < latest;
			if (saved === undefined && news) app.storage.write(entry, since);
			set(saved ?? (news ? since : latest));
		}
		const reload = () => set(app.storage.read(entry) ?? latest);
		let booted = false;
		const stops: (() => void)[] = [];

		app.decorate('changelog', {
			entries: options.entries.slice(0, options.show),
			latest,
			seen: () => {
				start();
				return seen;
			},
			markSeen() {
				start();
				if (seen >= latest) return;
				app.storage.write(entry, latest);
				set(latest);
			},
			subscribe(listener) {
				listeners.add(listener);
				listener(seen);
				return () => void listeners.delete(listener);
			}
		} satisfies AppChangelog);

		app.addHook('onBoot', () => {
			booted = true;
			start();
			const carry = update()?.carry;
			if (carry) stops.push(carry(CARRIED, () => latest));
			stops.push(
				app.storage.onChange((key) => {
					if (key === null || key === entry.key) reload();
				})
			);
			// With @xcwds/plugin-settings, What's new is a section of its page. Loaded lazily: the
			// component imports @xcwds/sveltekit, which imports this entry.
			const page = (app as { settingsPage?: SettingsPageLike }).settingsPage;
			if (page && options.entries.length)
				void import('./WhatsNew.svelte').then(({ default: WhatsNew }) => {
					if (booted) stops.push(page.add(WhatsNew, { order: 300 }));
				});
		});
		app.addHook('onReady', () => {
			const toast = (app as { toast?: ToastLike }).toast;
			if (news === null || !toast) return;
			const page = (app as { settingsPage?: SettingsPageLike }).settingsPage;
			if (!news) return toast('App updated to the latest version.');
			toast(
				'App updated.',
				page
					? { action: { label: "See what's new", path: page.options.path, hash: `#${SECTION_ID}` } }
					: {}
			);
		});
		app.addHook('onClose', () => {
			booted = false;
			for (const stop of stops.splice(0)) stop();
		});
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
