/** The plugin's options, checked the same way in the build and the page. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-settings';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.1.0';

export type SettingsOptions = {
	/** The settings page. Defaults to `/settings`. */
	path?: string;
	title?: string;
	/** Shown before the title in the header. Defaults to ⚙️; `''` shows none. */
	emoji?: string;
	/**
	 * The page's width (`@xcwds/sveltekit`'s route widths): `narrow` (the default), or `split`,
	 * narrow until wide screens, where an app's own settings page can lay out two columns.
	 */
	width?: 'narrow' | 'split';
	/** Titles for settings sections by id (fields' `section`), in the order they show. */
	sections?: Record<string, string>;
	/**
	 * Names for Your data's storage groups by id, in the order they show (`{ history: 'Workout
	 * history' }`). Groups left out are named after their entries and follow as registered.
	 */
	groups?: Record<string, string>;
	/** A link to the app's source code, shown under About. */
	source?: string;
	/** The backup file's name before the date, e.g. `xcwds-backup`. Defaults to `backup`. */
	backupName?: string;
};

export type ResolvedSettingsOptions = {
	path: string;
	title: string;
	emoji: string;
	width: 'narrow' | 'split';
	sections: Record<string, string>;
	groups: Record<string, string>;
	source: string | null;
	backupName: string;
};

/** Built-in titles; an app's `sections` come first and win. */
export const SECTION_TITLES: Record<string, string> = {
	appearance: 'Appearance',
	general: 'General',
	timers: 'Timers'
};

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

const isPath = (v: unknown): v is string =>
	typeof v === 'string' && v.startsWith('/') && !/[?#]/.test(v) && (v === '/' || !v.endsWith('/'));
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Checks options as written in the config and fills in the defaults. */
export function resolveOptions(input: unknown = {}): ResolvedSettingsOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const o = input as Record<string, unknown>;
	const known = [
		'path',
		'title',
		'emoji',
		'width',
		'sections',
		'groups',
		'source',
		'backupName',
		'prefix'
	];
	const unknown = Object.keys(o).filter((k) => !known.includes(k));
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const path = o.path ?? '/settings';
	if (!isPath(path) || path === '/')
		fail('`path` must be an app path other than "/" (no trailing slash, query or hash).');
	const title = o.title ?? 'Settings';
	if (!text(title)) fail('`title` must be a non-empty string.');
	const emoji = o.emoji ?? '⚙️';
	if (typeof emoji !== 'string' || (emoji !== '' && !text(emoji)))
		fail("`emoji` must be a string (`''` for none).");
	const width = o.width ?? 'narrow';
	if (width !== 'narrow' && width !== 'split') fail('`width` must be "narrow" or "split".');
	const titles = (v: unknown): v is Record<string, string> =>
		typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(text);
	const sections = o.sections ?? {};
	if (!titles(sections)) fail('`sections` must map section ids to titles.');
	const groups = o.groups ?? {};
	if (!titles(groups)) fail('`groups` must map storage group ids to names.');
	const source = o.source ?? null;
	if (source !== null && (typeof source !== 'string' || !/^https:\/\/\S+$/.test(source)))
		fail('`source` must be an https:// link.');
	const backupName = o.backupName ?? 'backup';
	if (typeof backupName !== 'string' || !/^[\w.-]+$/.test(backupName))
		fail('`backupName` may only have letters, digits, ".", "_" and "-".');
	return {
		path,
		title,
		emoji,
		width,
		sections: { ...sections },
		groups: { ...groups },
		source,
		backupName
	};
}

/** `<name>-YYYY-MM-DD.json`, in local time. */
export function backupFileName(name: string, now: Date): string {
	const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
		.map((n) => String(n).padStart(2, '0'))
		.join('-');
	return `${name}-${date}.json`;
}

/** Section ids in the order they show: the app's, then built-ins, then the rest as registered. */
export function sectionOrder(ids: readonly string[], titles: Record<string, string>): string[] {
	const present = new Set(ids);
	const first = [...Object.keys(titles), ...Object.keys(SECTION_TITLES)].filter((id) =>
		present.has(id)
	);
	return [...new Set([...first, ...ids])];
}

/** A section's title: the app's, a built-in one, or the id capitalised. */
export const sectionTitle = (id: string, titles: Record<string, string>) =>
	titles[id] ?? SECTION_TITLES[id] ?? id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');

/**
 * Your data's groups in the order they show, the ones `names` lists first (renamed), then the
 * rest as registered.
 */
export function orderGroups<G extends { id: string; label: string }>(
	groups: readonly G[],
	names: Record<string, string>
): G[] {
	const order = Object.keys(names);
	const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
	return groups
		.map((group, i) => ({ group, i }))
		.sort((a, b) => rank(a.group.id) - rank(b.group.id) || a.i - b.i)
		.map(({ group }) =>
			Object.hasOwn(names, group.id) ? { ...group, label: names[group.id]! } : group
		);
}
