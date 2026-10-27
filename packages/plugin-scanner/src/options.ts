/** The plugin's name, the @xcwds/core versions it works with, and its options. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-scanner';
/**
 * The same range as the peer dependency (`scripts/sync-core-version.js` moves it along with
 * core's minor versions).
 */
export const CORE = '^0.5.0';

/** The options, all JSON (RFC 0001, decision 1). */
export interface ScannerPluginOptions {
	/**
	 * The key of the blob collection that keeps the scan's pages, within the plugin's namespace
	 * (`app:scanner:<collection>`). Default `pages`.
	 */
	collection?: string;
}

const KEYS: readonly string[] = ['collection'];

/** The same shape as a storage namespace: lowercase letters, digits and dashes. */
const COLLECTION = /^[a-z0-9][a-z0-9-]*$/;

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

/** Checks options as written in the config, so a mistake fails the build rather than the page. */
export function resolveOptions(input: unknown = {}): ScannerPluginOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const options = input as Record<string, unknown>;
	const unknown = Object.keys(options).filter((k) => !KEYS.includes(k));
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const { collection } = options;
	if (collection === undefined) return {};
	if (typeof collection !== 'string' || !COLLECTION.test(collection))
		fail('`collection` must be lowercase letters, digits and dashes, such as "pages".');
	return { collection };
}
