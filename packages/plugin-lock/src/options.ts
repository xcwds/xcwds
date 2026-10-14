/** The plugin's options and the pure pieces of the page entry, checked the same way everywhere. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-lock';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.3.0';

export type LockOptions = {
	/** The unlock screen's path (default `/unlock`); the app needs a route file there. */
	unlock?: string;
};

export type ResolvedLockOptions = { unlock: string };

/** Checks options as written in the config. */
export function resolveOptions(input: unknown = {}): ResolvedLockOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: options must be an object.`, {
			plugin: NAME
		});
	const unknown = Object.keys(input).filter((key) => key !== 'prefix' && key !== 'unlock');
	if (unknown.length)
		throw new XcwdsError(
			codes.CONFIG_INVALID,
			`${NAME}: unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`,
			{ plugin: NAME }
		);
	const unlock = (input as LockOptions).unlock ?? '/unlock';
	if (typeof unlock !== 'string' || !/^(\/[\w-]+)+$/.test(unlock))
		throw new XcwdsError(
			codes.CONFIG_INVALID,
			`${NAME}: \`unlock\` must be an app path like "/unlock" (letters, digits, dashes and slashes).`,
			{ plugin: NAME }
		);
	return { unlock };
}

/** What the passcode locks: the private pages, or every page but the unlock screen. */
export type LockScope = 'private' | 'app';

/** Minutes hidden before the app locks itself (0: as soon as it's hidden). */
export const AUTO_LOCK_MINUTES = [0, 1, 5, 15] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_MINUTES)[number];

/** The `lock` settings field. */
export type LockSetting = {
	/** Cover private pages when the app is hidden, so the app switcher's snapshot doesn't show them. */
	cover: boolean;
	/** What the passcode locks, once one is set. */
	scope: LockScope;
	autoLockMinutes: AutoLockMinutes;
};

export const DEFAULT_LOCK: LockSetting = { cover: true, scope: 'private', autoLockMinutes: 1 };

/** A saved `lock` setting; a missing key is back to its default, so new keys need no migration. */
export function parseLock(v: unknown): LockSetting | undefined {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
	const raw = v as Record<string, unknown>;
	if (raw.cover !== undefined && typeof raw.cover !== 'boolean') return undefined;
	if (raw.scope !== undefined && raw.scope !== 'private' && raw.scope !== 'app') return undefined;
	if (
		raw.autoLockMinutes !== undefined &&
		!(AUTO_LOCK_MINUTES as readonly unknown[]).includes(raw.autoLockMinutes)
	)
		return undefined;
	const out: LockSetting = { ...DEFAULT_LOCK };
	if (raw.cover !== undefined) out.cover = raw.cover as boolean;
	if (raw.scope !== undefined) out.scope = raw.scope as LockScope;
	if (raw.autoLockMinutes !== undefined)
		out.autoLockMinutes = raw.autoLockMinutes as AutoLockMinutes;
	return out;
}

/** A path without a trailing slash (but `/` stays `/`), as the lock compares them. */
const trim = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/**
 * Whether a locked app keeps `path` behind the unlock screen: every page but the unlock screen
 * for the whole app, or only the private pages.
 */
export function needsUnlock(
	routes: { get(path: string): { private?: boolean } | undefined } | undefined,
	path: string,
	scope: LockScope,
	unlock: string
): boolean {
	if (trim(path) === trim(unlock)) return false;
	return scope === 'app' || isPrivate(routes, path);
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

/** Set on `<html>` while the page is hidden for the lock (before first paint, or while locking). */
export const CONCEALED = 'data-xcwds-locked';

/**
 * The head snippet (ES5) that hides the page before first paint when a passcode is set: a
 * reload or a link straight to a locked page mustn't show it while the app boots. The page entry
 * shows it again once it knows the page isn't locked. The key is the verifier's
 * (`<prefix>lock:verifier`).
 */
export function concealScript(prefix: string): string {
	const key = JSON.stringify(`${prefix}lock:verifier`).replace(/</g, '\\u003c');
	return (
		`if(localStorage.getItem(${key})){var r=document.documentElement;` +
		`r.setAttribute('${CONCEALED}','');r.style.setProperty('visibility','hidden','important');}`
	);
}
