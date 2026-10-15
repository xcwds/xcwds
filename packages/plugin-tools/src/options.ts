/** The plugin's options and the tool shape, checked the same way in the build and the page. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-tools';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.4.0';

/** One small tool: a page of its own, listed on the index page and pinnable to Home. */
export type Tool = {
	/**
	 * The tool's page, an app path such as `/utils/coffee-timer`, optionally with a `#fragment`
	 * for tools that share one page (`/my-apps/app#k3f9`, an app made of blocks). Pins and Recently
	 * used tell such tools apart by their fragment.
	 */
	path: string;
	name: string;
	emoji: string;
	/** One line under the name on the index page. */
	blurb: string;
	/**
	 * A personal tool (e.g. cycle tracking): never listed under Recently used, never shared from
	 * the Share button and never a manifest shortcut. Keep its name and emoji discreet too, since
	 * the index page and Home show them.
	 */
	private?: boolean;
	/** Adds the tool to the manifest's `shortcuts` (the home-screen icon's long-press menu). */
	shortcut?: boolean;
	/**
	 * The page's container: `narrow` (the default) or `split`, for a tool that uses two columns
	 * when there's room (`<main class="page-split @container">`).
	 */
	width?: 'narrow' | 'split';
	/** The id of the app (in `apps`) the tool belongs to. A tool in no app always shows. */
	app?: string;
};

/**
 * A group of tools (and other pages and data) people turn on and off on the Apps page (#158).
 * Turning one off only hides it: its pages still open and its data stays.
 */
export type AppGroup = {
	/** Lower-case letters, digits and dashes, e.g. `kitchen`. */
	id: string;
	name: string;
	emoji: string;
	/** One line on its card. */
	blurb: string;
	/** Makes every tool in it private (see `Tool.private`). */
	private?: boolean;
	/** Whether a fresh install starts with it on. Defaults to true. */
	default?: boolean;
	/** Other pages it owns, as path prefixes (e.g. `/recipes`), besides its tools. */
	routes?: string[];
	/** The storage groups that hold its data, which its card's Remove data clears. */
	groups?: string[];
};

export type ToolsOptions = {
	/** The index page listing every tool. Defaults to `/tools`. */
	path?: string;
	/** The index page's title. Defaults to `Tools`. */
	title?: string;
	/** The index page's emoji. */
	emoji?: string;
	items?: Tool[];
	/** Apps people turn on and off; a tool joins one with `app`. Without any, nothing changes. */
	apps?: AppGroup[];
	/** The Apps page (a route file rendering `AppCatalog.svelte`). Defaults to `/apps`. */
	catalog?: string;
	/**
	 * Where pins and recents are saved, as a full key starting with the storage prefix. Defaults
	 * to `app:tools:shortcuts`; set it to keep the key an app already uses (xcwds.github.io:
	 * `app:home:shortcuts`).
	 */
	storageKey?: string;
};

export type ResolvedToolsOptions = {
	path: string;
	title: string;
	emoji: string | undefined;
	items: Tool[];
	apps: AppGroup[];
	catalog: string;
	storageKey: string | undefined;
};

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

const isPath = (v: unknown): v is string =>
	typeof v === 'string' && v.startsWith('/') && !/[?#]/.test(v) && (v === '/' || !v.endsWith('/'));

const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** A fragment a tool's path can end with: 1-64 URL-safe characters. */
const FRAGMENT = /^#[A-Za-z0-9._~-]{1,64}$/;

/** A tool's path: an app path other than "/", optionally followed by a `#fragment`. */
export function isToolPath(v: unknown): v is string {
	if (typeof v !== 'string') return false;
	const { page, fragment } = splitToolPath(v);
	return isPath(page) && page !== '/' && (fragment === '' || FRAGMENT.test(fragment));
}

/** A tool's path as its page (an app path) and its fragment (`#…`, or empty). */
export function splitToolPath(path: string): { page: string; fragment: string } {
	const i = path.indexOf('#');
	return i < 0 ? { page: path, fragment: '' } : { page: path.slice(0, i), fragment: path.slice(i) };
}

const TOOL_KEYS = ['path', 'name', 'emoji', 'blurb', 'private', 'shortcut', 'width', 'app'];
const APP_KEYS = ['id', 'name', 'emoji', 'blurb', 'private', 'default', 'routes', 'groups'];

/** Checks one tool (from the options or `app.tools.add()`); returns a copy. */
export function checkTool(input: unknown, where = 'a tool'): Tool {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail(`${where} must be an object.`);
	const tool = input as Record<string, unknown>;
	const unknown = Object.keys(tool).filter((k) => !TOOL_KEYS.includes(k));
	if (unknown.length)
		fail(`${where} has unknown key ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	if (!isToolPath(tool.path))
		fail(
			`${where} needs a \`path\` (an app path other than "/", no trailing slash or query, and at most a short #fragment).`
		);
	const at = `the tool "${tool.path}"`;
	for (const key of ['name', 'emoji', 'blurb'])
		if (!text(tool[key])) fail(`${at} needs a \`${key}\`.`);
	for (const key of ['private', 'shortcut'])
		if (tool[key] !== undefined && typeof tool[key] !== 'boolean')
			fail(`\`${key}\` of ${at} must be true or false.`);
	if (tool.private && tool.shortcut) fail(`${at} is private, so it can't be a manifest shortcut.`);
	if (tool.width !== undefined && tool.width !== 'narrow' && tool.width !== 'split')
		fail(`\`width\` of ${at} must be "narrow" or "split".`);
	if (tool.app !== undefined && !isAppId(tool.app)) fail(`\`app\` of ${at} must be an app's id.`);
	const out: Tool = {
		path: tool.path,
		name: tool.name as string,
		emoji: tool.emoji as string,
		blurb: tool.blurb as string
	};
	if (tool.private) out.private = true;
	if (tool.shortcut) out.shortcut = true;
	if (tool.width === 'split') out.width = 'split';
	if (tool.app !== undefined) out.app = tool.app as string;
	return out;
}

const isAppId = (v: unknown): v is string =>
	typeof v === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v);

/** Checks one app from the options; returns a copy. */
export function checkApp(input: unknown, where = 'an app'): AppGroup {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail(`${where} must be an object.`);
	const app = input as Record<string, unknown>;
	const unknown = Object.keys(app).filter((k) => !APP_KEYS.includes(k));
	if (unknown.length)
		fail(`${where} has unknown key ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	if (!isAppId(app.id))
		fail(`${where} needs an \`id\` of lower-case letters, digits and dashes (e.g. "kitchen").`);
	const at = `the app "${app.id}"`;
	for (const key of ['name', 'emoji', 'blurb'])
		if (!text(app[key])) fail(`${at} needs a \`${key}\`.`);
	for (const key of ['private', 'default'])
		if (app[key] !== undefined && typeof app[key] !== 'boolean')
			fail(`\`${key}\` of ${at} must be true or false.`);
	const list = (key: 'routes' | 'groups', ok: (v: unknown) => boolean, what: string) => {
		const v = app[key];
		if (v === undefined) return undefined;
		if (!Array.isArray(v) || !v.every(ok)) fail(`\`${key}\` of ${at} must be a list of ${what}.`);
		return [...new Set(v as string[])];
	};
	const routes = list('routes', (v) => isPath(v) && v !== '/', 'app paths other than "/"');
	const groups = list('groups', text, 'storage group ids');
	const out: AppGroup = {
		id: app.id,
		name: app.name as string,
		emoji: app.emoji as string,
		blurb: app.blurb as string
	};
	if (app.private) out.private = true;
	if (app.default === false) out.default = false;
	if (routes?.length) out.routes = routes;
	if (groups?.length) out.groups = groups;
	return out;
}

/** Checks options as written in the config and fills in the defaults. */
export function resolveOptions(input: unknown = {}): ResolvedToolsOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const options = input as Record<string, unknown>;
	const unknown = Object.keys(options).filter(
		(k) =>
			!['path', 'title', 'emoji', 'items', 'apps', 'catalog', 'storageKey', 'prefix'].includes(k)
	);
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const path = options.path ?? '/tools';
	if (!isPath(path) || path === '/')
		fail('`path` must be an app path other than "/" (no trailing slash, query or hash).');
	const title = options.title ?? 'Tools';
	if (!text(title)) fail('`title` must be a non-empty string.');
	if (options.emoji !== undefined && !text(options.emoji))
		fail('`emoji` must be a non-empty string.');
	if (
		options.storageKey !== undefined &&
		(typeof options.storageKey !== 'string' || !/^[^\s:]+:\S+$/.test(options.storageKey))
	)
		fail('`storageKey` must be a full storage key such as "app:home:shortcuts".');
	const catalog = options.catalog ?? '/apps';
	if (!isPath(catalog) || catalog === '/' || catalog === path)
		fail('`catalog` must be an app path other than "/" and the index page.');
	const appsInput = options.apps ?? [];
	if (!Array.isArray(appsInput)) fail('`apps` must be a list of apps.');
	const apps = appsInput.map((a, i) => checkApp(a, `\`apps[${i}]\``));
	const ids = apps.map((a) => a.id);
	const twice = ids.find((id, i) => ids.indexOf(id) !== i);
	if (twice) fail(`there are two apps with the id "${twice}".`);
	const items = options.items ?? [];
	if (!Array.isArray(items)) fail('`items` must be a list of tools.');
	const list = new ToolList(path, apps, catalog);
	items.forEach((item, i) => list.add(checkTool(item, `\`items[${i}]\``)));
	return {
		path,
		title,
		emoji: options.emoji as string | undefined,
		items: list.all(),
		apps,
		catalog,
		storageKey: options.storageKey as string | undefined
	};
}

/**
 * The tools in the order they were added; refuses the index and Apps pages' paths, duplicates and
 * unknown apps. A tool in a private app becomes private.
 */
export class ToolList {
	#tools: Tool[] = [];
	constructor(
		readonly index: string,
		readonly apps: readonly AppGroup[] = [],
		readonly catalog?: string
	) {}

	add(input: Tool): Tool {
		const tool = { ...input };
		if (tool.path === this.index) fail(`the tool "${tool.path}" has the index page's path.`);
		if (this.apps.length && tool.path === this.catalog)
			fail(`the tool "${tool.path}" has the Apps page's path.`);
		if (this.#tools.some((t) => t.path === tool.path))
			fail(`there are two tools with the path "${tool.path}".`);
		if (tool.app !== undefined) {
			const app = this.apps.find((a) => a.id === tool.app);
			if (!app)
				fail(`the tool "${tool.path}" is in the app "${tool.app}", which isn't in \`apps\`.`);
			if (app.private) {
				if (tool.shortcut)
					fail(`the tool "${tool.path}" is in a private app, so it can't be a manifest shortcut.`);
				tool.private = true;
			}
		}
		this.#tools.push(tool);
		return tool;
	}

	/** Removes a tool; false if there's none at `path`. */
	remove(path: string): boolean {
		const before = this.#tools.length;
		this.#tools = this.#tools.filter((t) => t.path !== path);
		return this.#tools.length !== before;
	}

	all(): Tool[] {
		return [...this.#tools];
	}
}
