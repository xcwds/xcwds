/** The plugin's options, checked in the build. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-qr';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.5.0';

/** No options yet: the components and functions take theirs where they're used. */
export type QrPluginOptions = Record<string, never>;

/** Checks options as written in the config, so a mistake fails the build rather than the page. */
export function resolveOptions(input: unknown = {}): QrPluginOptions {
	const fail = (message: string): never => {
		throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
	};
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const unknown = Object.keys(input as object);
	if (unknown.length)
		fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}; it takes none yet.`);
	return {};
}
