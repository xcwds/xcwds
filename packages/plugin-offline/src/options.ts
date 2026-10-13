/** The plugin's options, checked the same way in the build, the page and the worker. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-offline';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.2.0';

export type OfflineOptions = {
	/** Extra app paths (without the base) to precache, beside everything the build emits. */
	precache?: string[];
	/**
	 * Globs of app paths never precached or cached at runtime, e.g. `/videos/**` (`*` matches
	 * within a segment, `**` across segments). Requests for them still go to the network.
	 */
	exclude?: string[];
	/** The page offline navigations get when nothing is cached for them. Defaults to `/404.html`. */
	fallback?: string;
	/**
	 * Keep same-origin pages and files that weren't precached (and have no query string) after
	 * they load, so they work offline too. They are kept in this version's cache, so an update
	 * drops them until they load again online. Defaults to `true`.
	 */
	runtimeCaching?: boolean;
};

export type ResolvedOfflineOptions = Required<OfflineOptions>;

const KEYS = ['precache', 'exclude', 'fallback', 'runtimeCaching', 'prefix'];
const isPath = (v: unknown): v is string =>
	typeof v === 'string' && v.startsWith('/') && !/[?#]/.test(v);

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

function paths(value: unknown, name: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || !value.every(isPath))
		fail(`\`${name}\` must be a list of app paths starting with "/" (no query or hash).`);
	return [...value];
}

/** Checks options as written in the config and fills in the defaults. */
export function resolveOptions(input: unknown = {}): ResolvedOfflineOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const options = input as Record<string, unknown>;
	const unknown = Object.keys(options).filter((key) => !KEYS.includes(key));
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const fallback = options.fallback ?? '/404.html';
	if (!isPath(fallback)) fail('`fallback` must be an app path starting with "/".');
	const runtimeCaching = options.runtimeCaching ?? true;
	if (typeof runtimeCaching !== 'boolean') fail('`runtimeCaching` must be true or false.');
	return {
		precache: paths(options.precache, 'precache'),
		exclude: paths(options.exclude, 'exclude'),
		fallback,
		runtimeCaching
	};
}
