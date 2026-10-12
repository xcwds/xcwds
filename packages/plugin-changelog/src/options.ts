/** The plugin's options, checked the same way in the build and the page. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-changelog';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.1.0';

/** One release note: a whole-number `id` (higher is newer), its date and user-facing lines. */
export type ChangelogEntry = { id: number; date: string; items: string[] };

export type ChangelogOptions = {
	/**
	 * The notes, newest first. Keep them in their own module and import it into
	 * `xcwds.config.ts` (`entries: changelog`), so each change adds one entry in one place.
	 */
	entries?: ChangelogEntry[];
	/** How many entries What's new lists. Defaults to 10. */
	show?: number;
	/**
	 * Where the newest entry seen is saved, as a full key starting with the storage prefix.
	 * Defaults to `app:changelog:seen`.
	 */
	storageKey?: string;
};

export type ResolvedChangelogOptions = {
	entries: ChangelogEntry[];
	show: number;
	storageKey: string | undefined;
};

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Checks options as written in the config and fills in the defaults. */
export function resolveOptions(input: unknown = {}): ResolvedChangelogOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const o = input as Record<string, unknown>;
	const unknown = Object.keys(o).filter(
		(k) => !['entries', 'show', 'storageKey', 'prefix'].includes(k)
	);
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const entries = o.entries ?? [];
	if (!Array.isArray(entries)) fail('`entries` must be a list.');
	let previous = Infinity;
	const out: ChangelogEntry[] = entries.map((raw: unknown, i) => {
		const at = `\`entries[${i}]\``;
		if (typeof raw !== 'object' || raw === null) fail(`${at} must be an object.`);
		const { id, date, items } = raw as Record<string, unknown>;
		if (!Number.isSafeInteger(id) || (id as number) < 1)
			fail(`${at} needs a whole-number \`id\` from 1.`);
		if (typeof date !== 'string' || !DATE.test(date))
			fail(`${at} needs a \`date\` like "2026-10-09".`);
		if (
			!Array.isArray(items) ||
			!items.length ||
			!items.every((s) => typeof s === 'string' && s.trim())
		)
			fail(`${at} needs \`items\`: one or more lines of text.`);
		if ((id as number) >= previous)
			fail(`entries must be newest first with unique ids (see ${at}).`);
		previous = id as number;
		return { id: id as number, date, items: [...(items as string[])] };
	});
	const show = o.show ?? 10;
	if (!Number.isSafeInteger(show) || (show as number) < 1)
		fail('`show` must be a whole number from 1.');
	const { storageKey } = o;
	if (
		storageKey !== undefined &&
		(typeof storageKey !== 'string' || !/^[^\s:]+:\S+$/.test(storageKey))
	)
		fail('`storageKey` must be a full storage key such as "app:settings:whats-new-seen".');
	return { entries: out, show: show as number, storageKey };
}

/** The newest entry's id, or 0 without entries. */
export const latestId = (entries: readonly ChangelogEntry[]) => entries[0]?.id ?? 0;
