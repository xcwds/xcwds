/**
 * Apps people turn on and off (#158): pure rules over the options and the `apps` setting, so
 * they're testable; the page entry holds the state.
 */
import type { AppGroup, Tool } from './options.js';

/** The `apps` setting: whether each app is on, by id. A missing id means the app's `default`. */
export type AppsSetting = Record<string, boolean>;

/** Validates the saved setting: keeps the true/false values (ids of removed apps too). */
export function parseAppsSetting(v: unknown): AppsSetting | undefined {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
	return Object.fromEntries(
		Object.entries(v).filter((e): e is [string, boolean] => typeof e[1] === 'boolean')
	);
}

/** Whether the app is on: what the person chose, else its default. Unknown apps are off. */
export function appIsOn(apps: readonly AppGroup[], setting: AppsSetting, id: string): boolean {
	const app = apps.find((a) => a.id === id);
	if (!app) return false;
	return typeof setting[id] === 'boolean' ? setting[id] : app.default !== false;
}

/**
 * The setting with the app turned on or off. Choosing an app's default removes its id, so a
 * change of the default in a later version still applies to people who never chose.
 */
export function withAppOn(
	apps: readonly AppGroup[],
	setting: AppsSetting,
	id: string,
	on: boolean
): AppsSetting {
	const app = apps.find((a) => a.id === id);
	const next = { ...setting };
	if (on === (app?.default !== false)) delete next[id];
	else next[id] = on;
	return next;
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** The app a page belongs to: its tool's app, or the app with a matching `routes` prefix. */
export function appOf(
	apps: readonly AppGroup[],
	tools: readonly Tool[],
	pathname: string
): AppGroup | undefined {
	const path = pathname.replace(/\/+$/, '') || '/';
	const tool = tools.find((t) => t.path === path);
	if (tool) return tool.app === undefined ? undefined : apps.find((a) => a.id === tool.app);
	// The longest prefix wins, so `/recipes/guide` can belong to another app than `/recipes`.
	let best: { app: AppGroup; length: number } | undefined;
	for (const app of apps)
		for (const prefix of app.routes ?? [])
			if (under(path, prefix) && (!best || prefix.length > best.length))
				best = { app, length: prefix.length };
	return best?.app;
}

/** Whether a tool shows (its app is on, or it's in no app). */
export const toolShows = (tool: Tool, isOn: (id: string) => boolean) =>
	tool.app === undefined || isOn(tool.app);

/** The ids of the apps that are off, in order: `data-apps-off` on `<html>` (#159). */
export const appsOff = (apps: readonly AppGroup[], setting: AppsSetting): string[] =>
	apps.filter((a) => !appIsOn(apps, setting, a.id)).map((a) => a.id);

/**
 * Plain ES5 for the `apps` field's `prePaint`: what `appsOff` gives, set as `data-apps-off` on
 * `<html>` before first paint, so the shell never flashes the tab of an app that's off. Ids are
 * `[a-z0-9-]`, so they're safe inside the string.
 */
export function applyAppsScript(apps: readonly AppGroup[]): string {
	const list = apps.map((a) => `['${a.id}',${a.default === false ? 'false' : 'true'}]`).join(',');
	return (
		"var o=v&&typeof v==='object'?v:{},off=[],l=[" +
		list +
		'];' +
		"for(var i=0;i<l.length;i++){var x=o[l[i][0]];if(typeof x==='boolean'?!x:!l[i][1])off.push(l[i][0])}" +
		"root.setAttribute('data-apps-off',off.join(' '));"
	);
}
