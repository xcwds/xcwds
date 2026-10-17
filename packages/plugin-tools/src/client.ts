/**
 * The page entry, ported from xcwds.github.io's `home.svelte.ts`: `app.tools` with the tool list
 * and Home's pinned and recently used tools, saved in storage. Opening a tool records it as
 * recently used (`afterNavigate`); with `@xcwds/plugin-shell`, Home shows both lists.
 *
 * Imported at prerender too, so it only touches browser globals once the app boots.
 */
import { definePlugin } from '@xcwds/core';
import type { Component } from 'svelte';
import {
	appIsOn,
	appOf,
	appsOff,
	applyAppsScript,
	parseAppsSetting,
	toolShows,
	withAppOn,
	type AppsSetting
} from './apps.js';
import {
	emptyShortcuts,
	parseShortcuts,
	sameShortcuts,
	withPinMoved,
	withPinToggled,
	withVisit,
	withoutTool,
	type HomeShortcuts
} from './home.js';
import {
	CORE,
	NAME,
	ToolList,
	checkTool,
	resolveOptions,
	splitToolPath,
	type Tool,
	type ToolsOptions
} from './options.js';
import type { AppTools, ToolShortcuts } from './types.js';
import type {} from '@xcwds/plugin-shell/client';
import type {} from '@xcwds/sveltekit/routes';

export type { AppTools, ToolShortcuts } from './types.js';

/** What this plugin uses of `app.settingsPage` (from `@xcwds/plugin-settings`, if present). */
type SettingsPageLike = { control(name: string, component: Component): () => void };

export default definePlugin(
	(app, input: ToolsOptions) => {
		const options = resolveOptions(input);
		const { apps } = options;
		const list = new ToolList(options.path, apps, options.catalog);
		for (const tool of options.items) list.add(tool);

		if (apps.length)
			app.settings.field('apps', {
				default: {},
				parse: parseAppsSetting,
				label: 'Apps',
				hint: 'Choose the apps you use.',
				section: 'general',
				// Lets the shell hide the tabs of apps that are off before first paint (#159).
				prePaint: applyAppsScript(apps)
			});
		const setting = (): AppsSetting => (apps.length ? (app.settings.get().apps ?? {}) : {});
		const isOn = (id: string) => appIsOn(apps, setting(), id);
		/** Follows tools added or removed after boot (`app.tools.subscribe`). */
		const toolListeners = new Set<() => void>();
		const toolsChanged = () => {
			for (const listener of toolListeners) listener();
		};
		const shows = (tool: Tool) => toolShows(tool, isOn);

		const entry = app.storage.entry('shortcuts', {
			label: 'Home shortcuts',
			parse: (raw) => parseShortcuts(raw, list.all()),
			...(options.storageKey ? { key: options.storageKey } : {})
		});

		let state: HomeShortcuts = emptyShortcuts();
		const listeners = new Set<(state: HomeShortcuts) => void>();
		const set = (next: HomeShortcuts) => {
			if (sameShortcuts(state, next)) return;
			state = next;
			for (const listener of listeners) listener(state);
		};
		const load = () => set(app.storage.read(entry) ?? emptyShortcuts());

		/**
		 * Applies `change` to the latest saved shortcuts (so another tab's changes aren't lost) and
		 * saves the result, unless nothing changed. Returns whether the result is saved. A failed
		 * save is reported unless `quiet`: for writes the user didn't ask for.
		 */
		function apply(
			change: (latest: HomeShortcuts) => HomeShortcuts,
			{ quiet = false } = {}
		): boolean {
			const storage = app.storage;
			const unsaved = storage.hasUnsavedChanges(entry);
			// Same starting point as update() below, so "nothing changed" is judged on what it would save.
			const base = storage.latest(entry, state, { unsaved }) ?? emptyShortcuts();
			if (sameShortcuts(base, change(base))) {
				set(base);
				return true;
			}
			const { value, saved } = storage.update(entry, state, (v) => change(v ?? emptyShortcuts()), {
				unsaved
			});
			set(value ?? emptyShortcuts());
			return quiet ? saved : storage.saveResult(entry, saved, { explicit: true });
		}

		const shortcuts: ToolShortcuts = {
			get state() {
				return state;
			},
			subscribe(listener) {
				listeners.add(listener);
				listener(state);
				return () => void listeners.delete(listener);
			},
			togglePin(path) {
				if (!list.all().some((t) => t.path === path)) return false;
				const pinned = state.pins.includes(path);
				const saved = apply((s) => withPinToggled(s, path));
				if (saved) app.toast?.(pinned ? 'Removed from Home.' : 'Pinned to Home.');
				return saved;
			},
			movePin(path, by) {
				const listed = new Set(
					list
						.all()
						.filter(shows)
						.map((t) => t.path)
				);
				return apply((s) => withPinMoved(s, path, by, (p) => listed.has(p)));
			},
			visit(pathname) {
				const { page, fragment } = splitToolPath(pathname);
				const trimmed = page.replace(/\/+$/, '') || '/';
				// A tool on a shared page is told apart by its fragment; any other fragment is the page.
				const path = list.all().some((t) => t.path === trimmed + fragment)
					? trimmed + fragment
					: trimmed;
				// Quiet: if storage is blocked, opening a tool shouldn't warn about a save the user
				// never made.
				if (list.all().some((t) => t.path === path))
					apply((s) => withVisit(s, path, list.all()), { quiet: true });
			},
			reload: load
		};

		app.decorate('tools', {
			index: options.path,
			catalog: apps.length ? options.catalog : undefined,
			list: () => list.all().filter(shows),
			all: () => list.all(),
			get: (path) => list.all().find((t) => t.path === path),
			add(tool) {
				list.add(checkTool(tool));
				toolsChanged();
			},
			update(tool) {
				if (!list.replace(checkTool(tool))) return false;
				toolsChanged();
				return true;
			},
			remove(path) {
				if (!list.remove(path)) return false;
				toolsChanged();
				// Quiet: removing the tool is what the person did; its pin goes with it.
				apply((s) => withoutTool(s, path), { quiet: true });
				return true;
			},
			apps: () => apps,
			appOf: (path) => appOf(apps, list.all(), path),
			isOn,
			setOn(id, on) {
				if (!apps.some((a) => a.id === id)) return false;
				if (isOn(id) === on) return true;
				app.settings.update((current) => ({
					apps: withAppOn(apps, current.apps ?? {}, id, on)
				}));
				return app.settings.save();
			},
			subscribe(listener) {
				listener();
				toolListeners.add(listener);
				const stopSettings = apps.length
					? app.settings.subscribe((next, prev) => {
							if (JSON.stringify(next.apps) !== JSON.stringify(prev.apps)) listener();
						})
					: () => {};
				return () => {
					toolListeners.delete(listener);
					stopSettings();
				};
			},
			shortcuts
		} satisfies AppTools);

		let stops: (() => void)[] = [];
		let closed = false;
		app.addHook('onBoot', async () => {
			// Marks <html> for the CSS that hides apps that are off; there's none in Node (#178).
			if (apps.length && typeof document !== 'undefined') {
				const root = document.documentElement;
				const mark = () => root.setAttribute('data-apps-off', appsOff(apps, setting()).join(' '));
				mark();
				stops.push(app.settings.subscribe(mark));
			}
			// A tool added from a page entry only has no title in the header and isn't prerendered.
			for (const tool of list.all())
				if (!app.routes.get(splitToolPath(tool.path).page))
					app.log.warn(
						`${NAME}: the tool "${tool.path}" has no route. Add it with app.tools.add() from your build entry too.`
					);
			load();
			stops.push(
				app.storage.onChange((key) => {
					if (key === null || key === entry.key) load();
				})
			);
			// Home's blocks, when the app has the shell. Loaded lazily: the component imports
			// @xcwds/sveltekit, which imports this entry.
			// With @xcwds/plugin-settings, the apps field shows as a link to the Apps page.
			const page = (app as { settingsPage?: SettingsPageLike }).settingsPage;
			if (page && apps.length)
				void import('./AppsLink.svelte').then(({ default: AppsLink }) => {
					if (!closed) stops.push(page.control('apps', AppsLink));
				});
			const home = app.shell?.home;
			if (!home) return;
			const { default: HomeShortcuts } = await import('./HomeShortcuts.svelte');
			if (closed) return;
			stops.push(home.add(HomeShortcuts, { order: 0 }));
		});
		app.addHook('afterNavigate', (to) => shortcuts.visit(to.path + (to.url?.hash ?? '')));
		app.addHook('onClose', () => {
			closed = true;
			for (const stop of stops) stop();
			stops = [];
			toolListeners.clear();
		});
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
