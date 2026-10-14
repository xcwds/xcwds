/** The plugin's options, checked the same way in the build and the page. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-timers';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.3.0';

export type TimersOptions = {
	/** The page that lists timers (an app path), for the Open link on finished-timer alerts. */
	page?: string;
	/**
	 * Where timers are saved, as a full key starting with the storage prefix. Defaults to
	 * `app:timers:timers`; set it to keep the key an app already uses (xcwds.github.io:
	 * `app:cooking-timer:timers`).
	 */
	storageKey?: string;
};

export type ResolvedTimersOptions = { page: string | null; storageKey: string | undefined };

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

const isPath = (v: unknown): v is string =>
	typeof v === 'string' && v.startsWith('/') && !/[?#]/.test(v) && (v === '/' || !v.endsWith('/'));

/** Checks options as written in the config and fills in the defaults. */
export function resolveOptions(input: unknown = {}): ResolvedTimersOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const options = input as Record<string, unknown>;
	const unknown = Object.keys(options).filter((k) => !['page', 'storageKey', 'prefix'].includes(k));
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const page = options.page ?? null;
	if (page !== null && !isPath(page))
		fail('`page` must be an app path (no trailing slash, query or hash).');
	const { storageKey } = options;
	if (
		storageKey !== undefined &&
		(typeof storageKey !== 'string' || !/^[^\s:]+:\S+$/.test(storageKey))
	)
		fail('`storageKey` must be a full storage key such as "app:cooking-timer:timers".');
	return { page, storageKey };
}

/** The alarm setting (`settings.alarm`): how a finished timer gets your attention. */
export type AlarmSetting = { sound: boolean; vibration: boolean; keepAwake: boolean };

export const DEFAULT_ALARM: AlarmSetting = { sound: true, vibration: true, keepAwake: true };

export function parseAlarm(v: unknown): AlarmSetting | undefined {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
	const raw = v as Record<string, unknown>;
	// A missing field is back to its default, so a new field needs no migration.
	const out = { ...DEFAULT_ALARM };
	for (const key of Object.keys(DEFAULT_ALARM) as (keyof AlarmSetting)[]) {
		if (raw[key] === undefined) continue;
		if (typeof raw[key] !== 'boolean') return undefined;
		out[key] = raw[key];
	}
	return out;
}
