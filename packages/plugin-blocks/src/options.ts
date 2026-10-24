/** The plugin's options, checked the same way in the build and the page. */
import { XcwdsError, codes } from '@xcwds/core';
import { parseApp, type AppDefinition } from './format.js';
import { templates as builtIn } from './templates.js';

export const NAME = '@xcwds/plugin-blocks';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.5.0';

/** The options, all JSON (RFC 0001, decision 1). */
export type BlocksPluginOptions = {
	/** Where Your apps lives (default `/my-apps`); apps open at `<path>/app#<id>`. */
	path?: string;
	/** What "Add from a template" offers (default: Water, Chores and Mood). */
	templates?: AppDefinition[];
	/** The `@xcwds/plugin-tools` app (in its `apps`) your apps join as tools, if any. */
	app?: string;
};

export type ResolvedBlocksOptions = {
	path: string;
	templates: AppDefinition[];
	app?: string;
};

const KEYS = ['path', 'templates', 'app'];

export function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

/** Checks options as written in the config, so a mistake fails the build rather than the page. */
export function resolveOptions(input: unknown = {}): ResolvedBlocksOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const options = input as Record<string, unknown>;
	const unknown = Object.keys(options).filter((k) => !KEYS.includes(k));
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const { path = '/my-apps', templates = builtIn, app } = options;
	if (typeof path !== 'string' || !/^\/[^?#\s]*[^/?#\s]$/.test(path))
		fail('`path` must be an app path such as `/my-apps`, with no trailing slash.');
	if (!Array.isArray(templates)) fail('`templates` must be a list of app definitions.');
	const checked = templates.map((template, i) => {
		const parsed = parseApp(template);
		if (!parsed.ok) fail(`template ${i + 1}: ${parsed.error}`);
		return parsed.value;
	});
	const ids = new Set(checked.map((t) => t.id));
	if (ids.size !== checked.length) fail('two templates have the same `id`.');
	if (app !== undefined && (typeof app !== 'string' || !app))
		fail('`app` must be the id of an app in `@xcwds/plugin-tools`’ `apps`.');
	return { path, templates: checked, ...(app ? { app: app as string } : {}) };
}
