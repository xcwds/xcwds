/**
 * The service-worker entry: `app.tools` as the build has it (every tool and app from the options,
 * each app as it starts), so worker plugins can tell which app a page belongs to
 * (`@xcwds/plugin-offline`'s `byApp`). Whether an app is on lives in the page's settings, which
 * the worker can't read: a page that needs the worker to know sends it.
 */
import { definePlugin } from '@xcwds/core';
import { CORE, NAME, ToolList, resolveOptions, type ToolsOptions } from './options.js';
import { staticTools } from './static.js';

export default definePlugin(
	(app, input: ToolsOptions) => {
		const options = resolveOptions(input);
		const list = new ToolList(options.path, options.apps, options.catalog);
		const add = (tool: Parameters<ToolList['add']>[0]) => void list.add(tool);
		for (const tool of options.items) add(tool);
		app.decorate('tools', staticTools(options, list, add));
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
