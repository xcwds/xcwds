/**
 * The page entry: your apps as `app.blocks` (#160), saved in this plugin's namespace
 * (`app:blocks:…`). With `@xcwds/plugin-tools`, each app is also a tool (in the `app` option's
 * catalog app, if given), so it can be pinned on Home and shows in Recently used, private ones
 * never; the tools follow your apps as they're added, renamed, turned private or removed, here
 * or in another tab. With `@xcwds/plugin-vault`, private apps can't be read while the app is
 * locked, so one private tool (`<path>/private`, 🔒) stands in for them until it's unlocked
 * (#265). Imported at prerender too, so it only touches browser globals when called.
 */
import { definePlugin } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type BlocksPluginOptions } from './options.js';
import {
	createBlocks,
	registerEntries,
	type AppSummary,
	type Blocks,
	type VaultLike
} from './store.js';
import { lockedText } from './view.js';

export type { AppSummary, Blocks, Removed, Saved, Usage } from './store.js';
export { NEAR_LIMIT } from './store.js';
export { lockedText } from './view.js';
export type { BlocksPluginOptions } from './options.js';

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-blocks`: your apps and their data. */
		readonly blocks?: Blocks;
	}
}

/** What this plugin uses of `app.tools` (from `@xcwds/plugin-tools`, if the app has it). */
type ToolsLike = {
	get(path: string): unknown;
	add(tool: {
		path: string;
		name: string;
		emoji: string;
		blurb: string;
		private?: boolean;
		app?: string;
	}): void;
	remove(path: string): boolean;
	update?(tool: Parameters<ToolsLike['add']>[0]): boolean;
};

/** The emoji a tool shows for an app that has none. */
export const DEFAULT_EMOJI = '🧩';

export default definePlugin(
	(app, input: BlocksPluginOptions) => {
		const options = resolveOptions(input);
		const store = createBlocks(app.storage, registerEntries(app.storage), {
			...options,
			vault: () => (app as { vault?: VaultLike }).vault
		});
		const blocks: Blocks = store;
		app.decorate('blocks', blocks);

		/** The tools this plugin added, by path, with what they showed. */
		const added = new Map<string, string>();
		const toolOf = (a: AppSummary) => ({
			path: a.path,
			name: a.name,
			emoji: a.emoji ?? DEFAULT_EMOJI,
			blurb: 'One of your apps.',
			...(a.private ? { private: true } : {}),
			...(options.app ? { app: options.app } : {})
		});
		function sync() {
			store.keepCount();
			const tools = (app as { tools?: ToolsLike }).tools;
			if (!tools) return;
			const now = new Map(blocks.list().map((a) => [a.path, toolOf(a)]));
			const locked = blocks.lockedCount();
			if (locked) {
				// The lock's guard sends it to the unlock screen, then back to Your apps.
				const path = `${options.path}/private`;
				now.set(path, {
					path,
					name: 'Private apps',
					emoji: '🔒',
					blurb: `${lockedText(locked)}.`,
					private: true,
					...(options.app ? { app: options.app } : {})
				});
			}
			for (const [path, shown] of added) {
				const next = now.get(path);
				if (next && JSON.stringify(next) === shown) continue;
				// Renamed or a new emoji: in place, so its pin stays (plugin-tools 0.5 and later).
				if (next && tools.update?.(next)) {
					added.set(path, JSON.stringify(next));
					continue;
				}
				tools.remove(path);
				added.delete(path);
			}
			for (const [path, tool] of now) {
				if (added.has(path) || tools.get(path)) continue;
				tools.add(tool);
				added.set(path, JSON.stringify(tool));
			}
		}

		let stop: (() => void) | undefined;
		app.addHook('onBoot', () => {
			sync();
			stop = blocks.onChange(sync);
		});
		app.addHook('onClose', () => stop?.());
	},
	{
		name: NAME,
		namespace: 'blocks',
		core: CORE,
		encapsulate: false,
		network: false
	}
);
