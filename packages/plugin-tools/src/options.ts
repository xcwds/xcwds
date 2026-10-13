/** The plugin's options and the tool shape, checked the same way in the build and the page. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-tools';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.2.0';

/** One small tool: a page of its own, listed on the index page and pinnable to Home. */
export type Tool = {
	/** The tool's page, an app path such as `/utils/coffee-timer`. */
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
};

export type ToolsOptions = {
	/** The index page listing every tool. Defaults to `/tools`. */
	path?: string;
	/** The index page's title. Defaults to `Tools`. */
	title?: string;
	/** The index page's emoji. */
	emoji?: string;
	items?: Tool[];
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
	storageKey: string | undefined;
};

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

const isPath = (v: unknown): v is string =>
	typeof v === 'string' && v.startsWith('/') && !/[?#]/.test(v) && (v === '/' || !v.endsWith('/'));

const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

const TOOL_KEYS = ['path', 'name', 'emoji', 'blurb', 'private', 'shortcut', 'width'];

/** Checks one tool (from the options or `app.tools.add()`); returns a copy. */
export function checkTool(input: unknown, where = 'a tool'): Tool {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail(`${where} must be an object.`);
	const tool = input as Record<string, unknown>;
	const unknown = Object.keys(tool).filter((k) => !TOOL_KEYS.includes(k));
	if (unknown.length)
		fail(`${where} has unknown key ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	if (!isPath(tool.path) || tool.path === '/')
		fail(
			`${where} needs a \`path\` (an app path other than "/", no trailing slash, query or hash).`
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
	const out: Tool = {
		path: tool.path,
		name: tool.name as string,
		emoji: tool.emoji as string,
		blurb: tool.blurb as string
	};
	if (tool.private) out.private = true;
	if (tool.shortcut) out.shortcut = true;
	if (tool.width === 'split') out.width = 'split';
	return out;
}

/** Checks options as written in the config and fills in the defaults. */
export function resolveOptions(input: unknown = {}): ResolvedToolsOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const options = input as Record<string, unknown>;
	const unknown = Object.keys(options).filter(
		(k) => !['path', 'title', 'emoji', 'items', 'storageKey', 'prefix'].includes(k)
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
	const items = options.items ?? [];
	if (!Array.isArray(items)) fail('`items` must be a list of tools.');
	const list = new ToolList(path);
	items.forEach((item, i) => list.add(checkTool(item, `\`items[${i}]\``)));
	return {
		path,
		title,
		emoji: options.emoji as string | undefined,
		items: list.all(),
		storageKey: options.storageKey as string | undefined
	};
}

/** The tools in the order they were added; refuses the index path and duplicates. */
export class ToolList {
	#tools: Tool[] = [];
	constructor(readonly index: string) {}

	add(tool: Tool): Tool {
		if (tool.path === this.index) fail(`the tool "${tool.path}" has the index page's path.`);
		if (this.#tools.some((t) => t.path === tool.path))
			fail(`there are two tools with the path "${tool.path}".`);
		this.#tools.push(tool);
		return tool;
	}

	all(): Tool[] {
		return [...this.#tools];
	}
}
