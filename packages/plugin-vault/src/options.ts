/** The plugin's name, the @xcwds/core versions it works with, and its (empty) options. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-vault';
/**
 * The same range as the peer dependency (`scripts/sync-core-version.js` moves it along with
 * core's minor versions).
 */
export const CORE = '^0.5.0';
/** The plugin it needs registered before it: the vault's key comes from the lock's passcode. */
export const LOCK = '@xcwds/plugin-lock';

/** No options yet: which groups are sealed is each entry's `sensitive`. */
export type VaultPluginOptions = Record<string, never>;

/** Checks options as written in the config, so a mistake fails the build rather than the page. */
export function resolveOptions(input: unknown = {}): VaultPluginOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: options must be an object.`, {
			plugin: NAME
		});
	const unknown = Object.keys(input).filter((key) => key !== 'prefix');
	if (unknown.length)
		throw new XcwdsError(
			codes.CONFIG_INVALID,
			`${NAME}: unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`,
			{ plugin: NAME }
		);
	return {};
}
