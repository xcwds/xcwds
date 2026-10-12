/** The plugin's options and the pure pieces of the page entry, checked the same way everywhere. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-lock';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.1.0';

/** The plugin has no options yet (the passcode lock, #76, will add some). */
export type LockOptions = Record<string, never>;

/** Checks options as written in the config. */
export function resolveOptions(input: unknown = {}): LockOptions {
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

/** The `lock` settings field. */
export type LockSetting = {
	/** Cover private pages when the app is hidden, so the app switcher's snapshot doesn't show them. */
	cover: boolean;
};

export const DEFAULT_LOCK: LockSetting = { cover: true };

/** A saved `lock` setting; a missing key is back to its default, so new keys need no migration. */
export function parseLock(v: unknown): LockSetting | undefined {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
	const raw = v as Record<string, unknown>;
	if (raw.cover !== undefined && typeof raw.cover !== 'boolean') return undefined;
	return { ...DEFAULT_LOCK, ...(raw.cover === undefined ? {} : { cover: raw.cover }) };
}

/** Whether `path` is a private page in the route registry (`app.routes`, from @xcwds/sveltekit). */
export function isPrivate(
	routes: { get(path: string): { private?: boolean } | undefined } | undefined,
	path: string
): boolean {
	return routes?.get(path)?.private === true;
}

/**
 * Set on text fields in a private page's `<main>`: enhanced spellcheck in some browsers sends what
 * you type to a server, and autocomplete keeps it in the browser's form history.
 */
export const HYGIENE: Readonly<Record<string, string>> = Object.freeze({
	spellcheck: 'false',
	autocomplete: 'off',
	autocapitalize: 'off'
});

/** Input types that take typed text (other types, like checkboxes, are left alone). */
const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** Whether a field (by tag name and `type` attribute) takes typed text. */
export function isTextField(tagName: string, type: string | null): boolean {
	const tag = tagName.toLowerCase();
	if (tag === 'textarea') return true;
	return tag === 'input' && TEXT_TYPES.has((type ?? '').toLowerCase());
}
