/** `app.tools` where nothing is saved (the build and the service worker): each app as it starts. */
import { appOf } from './apps.js';
import { checkTool, type ResolvedToolsOptions, type Tool, type ToolList } from './options.js';
import type { AppTools } from './types.js';

export function staticTools(
	options: ResolvedToolsOptions,
	list: ToolList,
	add: (tool: Tool) => void
): AppTools {
	const { apps } = options;
	const startsOn = (id: string) => apps.some((a) => a.id === id && a.default !== false);
	return {
		index: options.path,
		catalog: apps.length ? options.catalog : undefined,
		get: (path) => list.all().find((t) => t.path === path),
		add: (tool) => add(checkTool(tool)),
		remove: () => false,
		update: () => false,
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
	};
}
