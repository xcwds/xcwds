/**
 * The page entry, ported from xcwds.github.io's `home.svelte.ts`: `app.tools` with the tool list
 * and Home's pinned and recently used tools, saved in storage. Opening a tool records it as
 * recently used (`afterNavigate`); with `@xcwds/plugin-shell`, Home shows both lists.
 *
 * Imported at prerender too, so it only touches browser globals once the app boots.
 */
import { definePlugin } from '@xcwds/core';
import {
	emptyShortcuts,
	parseShortcuts,
	sameShortcuts,
	withPinMoved,
	withPinToggled,
	withVisit,
	type HomeShortcuts
} from './home.js';
import { CORE, NAME, ToolList, checkTool, resolveOptions, type ToolsOptions } from './options.js';
import type { AppTools, ToolShortcuts } from './types.js';
import type {} from '@xcwds/plugin-shell/client';
import type {} from '@xcwds/sveltekit/routes';

export type { AppTools, ToolShortcuts } from './types.js';

export default definePlugin(
	(app, input: ToolsOptions) => {
		const options = resolveOptions(input);
		const list = new ToolList(options.path);
		for (const tool of options.items) list.add(tool);

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
			movePin: (path, by) => apply((s) => withPinMoved(s, path, by)),
			visit(pathname) {
				const path = pathname.replace(/\/+$/, '') || '/';
				// Quiet: if storage is blocked, opening a tool shouldn't warn about a save the user
				// never made.
				if (list.all().some((t) => t.path === path))
					apply((s) => withVisit(s, path, list.all()), { quiet: true });
			},
			reload: load
		};

		app.decorate('tools', {
			index: options.path,
			list: () => list.all(),
			get: (path) => list.all().find((t) => t.path === path),
			add: (tool) => void list.add(checkTool(tool)),
			shortcuts
		} satisfies AppTools);

		let stops: (() => void)[] = [];
		let closed = false;
		app.addHook('onBoot', async () => {
			// A tool added from a page entry only has no title in the header and isn't prerendered.
			for (const tool of list.all())
				if (!app.routes.get(tool.path))
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
			const home = app.shell?.home;
			if (!home) return;
			const { default: HomeShortcuts } = await import('./HomeShortcuts.svelte');
			if (closed) return;
			stops.push(home.add(HomeShortcuts, { order: 0 }));
		});
		app.addHook('afterNavigate', (to) => shortcuts.visit(to.path));
		app.addHook('onClose', () => {
			closed = true;
			for (const stop of stops) stop();
			stops = [];
		});
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
