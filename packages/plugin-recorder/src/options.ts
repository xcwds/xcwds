/** The plugin's name, the @xcwds/core versions it works with, and its options. */
import { XcwdsError, codes } from '@xcwds/core';
import type { RecorderOptions } from './recorder.js';

export const NAME = '@xcwds/plugin-recorder';
/**
 * The same range as the peer dependency (`scripts/sync-core-version.js` moves it along with
 * core's minor versions).
 */
export const CORE = '^0.4.0';

/** The options, all JSON (RFC 0001, decision 1): the recorder's, as written. */
export type RecorderPluginOptions = RecorderOptions;

const SWITCHES = ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const;
const KEYS: readonly string[] = [...SWITCHES, 'timeslice'];

/** The shortest and longest `timeslice`: chunks saved more often than this just add writes. */
export const TIMESLICE = { min: 250, max: 60_000 } as const;

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

/** Checks options as written in the config, so a mistake fails the build rather than the page. */
export function resolveOptions(input: unknown = {}): RecorderOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const options = input as Record<string, unknown>;
	const unknown = Object.keys(options).filter((k) => !KEYS.includes(k));
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const out: RecorderOptions = {};
	for (const key of SWITCHES) {
		const value = options[key];
		if (value === undefined) continue;
		if (typeof value !== 'boolean') fail(`\`${key}\` must be true or false.`);
		out[key] = value;
	}
	const { timeslice } = options;
	if (timeslice !== undefined) {
		if (
			!Number.isInteger(timeslice) ||
			(timeslice as number) < TIMESLICE.min ||
			(timeslice as number) > TIMESLICE.max
		)
			fail(`\`timeslice\` must be a whole number of ms from ${TIMESLICE.min} to ${TIMESLICE.max}.`);
		out.timeslice = timeslice as number;
	}
	return out;
}
