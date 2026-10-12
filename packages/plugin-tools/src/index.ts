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
import { definePlugin, descriptor } from '@xcwds/core';
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

export type { ResolvedToolsOptions, Tool, ToolsOptions } from './options.js';
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
		const list = new ToolList(options.path);
		app.route({
			path: options.path,
			title: options.title,
			...(options.emoji ? { emoji: options.emoji } : {}),
			width: 'wide'
		});
		const add = (tool: Tool) => {
			list.add(tool);
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
		app.decorate('tools', {
			index: options.path,
			get: (path) => list.all().find((t) => t.path === path),
			add: (tool) => add(checkTool(tool)),
			list: () => list.all()
		} satisfies AppTools);

		app.addHook('onManifest', (manifest) => {
			const shortcuts = list.all().filter((t) => t.shortcut && !t.private);
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
