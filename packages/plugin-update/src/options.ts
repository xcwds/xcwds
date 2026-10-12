/** The plugin's options, checked the same way in the build, the page and the worker. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-update';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.1.0';

/** The message a page sends the waiting worker to make it take over. */
export const SKIP_WAITING = 'SKIP_WAITING';

export type UpdateOptions = {
	/** How often to look for a new version while the app is open, in ms (0: only on launch and
	 * when the app comes back). Defaults to an hour. */
	checkEveryMs?: number;
	/** When something a reload would interrupt is running, ask before reloading. Defaults to `true`. */
	askBeforeReload?: boolean;
	/**
	 * The session storage key the old version sets just before it reloads into the new one.
	 * Defaults to `xcwds:just-updated`; set it to the key an app used before it moved onto
	 * @xcwds (xcwds.github.io: `app:just-updated`), so its first update still says what's new.
	 */
	marker?: string;
};

export type ResolvedUpdateOptions = Required<UpdateOptions>;

/** The default `marker`. */
export const JUST_UPDATED = 'xcwds:just-updated';

const KEYS = ['checkEveryMs', 'askBeforeReload', 'marker', 'prefix'];

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

/** Checks options as written in the config and fills in the defaults. */
export function resolveOptions(input: unknown = {}): ResolvedUpdateOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const options = input as Record<string, unknown>;
	const unknown = Object.keys(options).filter((key) => !KEYS.includes(key));
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const checkEveryMs = options.checkEveryMs ?? 60 * 60 * 1000;
	// setInterval can't wait longer than 2^31 - 1 ms (about 24.8 days).
	if (
		typeof checkEveryMs !== 'number' ||
		!Number.isInteger(checkEveryMs) ||
		checkEveryMs < 0 ||
		checkEveryMs > 2 ** 31 - 1
	)
		fail('`checkEveryMs` must be a whole number of milliseconds, 0 to 2147483647.');
	const askBeforeReload = options.askBeforeReload ?? true;
	if (typeof askBeforeReload !== 'boolean') fail('`askBeforeReload` must be true or false.');
	const marker = options.marker ?? JUST_UPDATED;
	if (typeof marker !== 'string' || marker.trim() === '')
		fail('`marker` must be a non-empty string.');
	return { checkEveryMs, askBeforeReload, marker };
}
