/**
 * `@xcwds/plugin-tools`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import tools from '@xcwds/plugin-tools';
 * export default defineConfig({
 * 	brand,
 * 	plugins: [
 * 		shell({ sections }),
 * 		tools({
 * 			path: '/utils',
 * 			title: 'Utils',
 * 			items: [{ path: '/utils/coffee-timer', emoji: '☕', name: 'Coffee Timer', blurb: '90-second countdown.' }]
 * 		})
 * 	]
 * });
 * ```
 *
 * The build entry adds the index page and every tool to the route registry (so they are
 * prerendered and the shell knows their titles) and the manifest's `shortcuts`.
 */
import { XcwdsError, codes, definePlugin, descriptor } from '@xcwds/core';
import { appOf } from './apps.js';
import {
	CORE,
	NAME,
	ToolList,
	checkTool,
	resolveOptions,
	type Tool,
	type ToolsOptions
} from './options.js';
import type { AppTools } from './types.js';

export type { AppGroup, ResolvedToolsOptions, Tool, ToolsOptions } from './options.js';
export {
	appIsOn,
	appOf,
	appsOff,
	applyAppsScript,
	parseAppsSetting,
	toolShows,
	withAppOn,
	type AppsSetting
} from './apps.js';
export {
	MAX_RECENT,
	parseShortcuts,
	withPinMoved,
	withPinToggled,
	withVisit,
	type HomeShortcuts
} from './home.js';

export default descriptor<ToolsOptions>(NAME);

export type { AppTools, ToolShortcuts } from './types.js';

export const build = definePlugin(
	(app, input: ToolsOptions) => {
		const options = resolveOptions(input);
		const { apps } = options;
		// With @xcwds/plugin-shell registered first, its sections' apps must be ours (#159).
		const sections = (app as { shellSections?: readonly { path: string; app?: string }[] })
			.shellSections;
		for (const s of sections ?? [])
			if (s.app !== undefined && !apps.some((a) => a.id === s.app))
				throw new XcwdsError(
					codes.CONFIG_INVALID,
					`@xcwds/plugin-shell: the section "${s.path}" is in the app "${s.app}", which isn't in ${NAME}'s \`apps\`.`,
					{ plugin: NAME }
				);
		const list = new ToolList(options.path, apps, options.catalog);
		app.route({
			path: options.path,
			title: options.title,
			...(options.emoji ? { emoji: options.emoji } : {}),
			width: 'wide'
		});
		// The Apps page, linked from the index page.
		if (apps.length)
			app.route({
				path: options.catalog,
				title: 'Apps',
				emoji: '🧩',
				parent: options.path,
				width: 'wide'
			});
		const add = (input: Tool) => {
			const tool = list.add(input);
			app.route({
				path: tool.path,
				title: tool.name,
				emoji: tool.emoji,
				parent: options.path,
				width: tool.width ?? 'narrow',
				...(tool.private ? { private: true } : {})
			});
		};
		for (const tool of options.items) add(tool);
		const startsOn = (id: string) => apps.some((a) => a.id === id && a.default !== false);
		app.decorate('tools', {
			index: options.path,
			catalog: apps.length ? options.catalog : undefined,
			get: (path) => list.all().find((t) => t.path === path),
			add: (tool) => add(checkTool(tool)),
			list: () => list.all(),
			all: () => list.all(),
			apps: () => apps,
			appOf: (path) => appOf(apps, list.all(), path),
			isOn: startsOn,
			setOn: () => false,
			subscribe(listener) {
				listener();
				return () => {};
			}
		} satisfies AppTools);

		app.addHook('onManifest', (manifest) => {
			// Written once for everyone, so only tools of apps that start on (or in no app).
			const shortcuts = list
				.all()
				.filter((t) => t.shortcut && !t.private && (t.app === undefined || startsOn(t.app)));
			if (!shortcuts.length) return manifest;
			// The manifest's scope is the base path plus "/".
			const scope = typeof manifest.scope === 'string' ? manifest.scope : '/';
			const existing = Array.isArray(manifest.shortcuts) ? manifest.shortcuts : [];
			return {
				...manifest,
				shortcuts: [
					...existing,
					...shortcuts.map((t) => ({
						name: t.name,
						description: t.blurb,
						url: scope.replace(/\/$/, '') + t.path
					}))
				]
			};
		});
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
