/** The plugin's options, checked the same way in the build and the page. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = 'xcwds-plugin-tally';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.3.0';

export type TallyOptions = {
	/** The tally page, an app path. Default `/tally`. */
	path?: string;
	/** How much one tap adds, until the user picks their own step in Settings. Default 1. */
	step?: number;
};

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

/** Checks options as written in the config and fills in the defaults. */
export function resolveOptions(options: TallyOptions = {}): Required<TallyOptions> {
	const { path = '/tally', step = 1, ...rest } = options;
	const unknown = Object.keys(rest);
	if (unknown.length) fail(`unknown option \`${unknown[0]}\`.`);
	if (typeof path !== 'string' || !/^\/[a-z0-9/-]*$/.test(path) || path.endsWith('/'))
		fail('`path` must be an app path such as "/tally".');
	if (!isStep(step)) fail('`step` must be a whole number from 1 to 100.');
	return { path, step };
}

export const isStep = (v: unknown): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100;
