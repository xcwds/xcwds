/** The plugin's options, checked the same way in the build and the page. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-shell';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.2.0';

/** A top-level section: a tab on phones, a header link or sidebar entry elsewhere. */
export type Section = {
	/** An app path (without the base path); `/` is Home. */
	path: string;
	label: string;
	emoji?: string;
	/** Other paths this section owns (and everything under them), e.g. `/guide` for Recipes. */
	also?: string[];
};

export type ShellOptions = {
	/** In order. Defaults to Home alone (then there is no tab bar or sidebar). */
	sections?: Section[];
};

export type ResolvedShellOptions = { sections: Section[] };

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

const isPath = (v: unknown): v is string =>
	typeof v === 'string' && v.startsWith('/') && !/[?#]/.test(v) && (v === '/' || !v.endsWith('/'));
const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks options as written in the config and fills in the defaults. */
export function resolveOptions(input: unknown = {}): ResolvedShellOptions {
	if (!isRecord(input)) fail('options must be an object.');
	const unknown = Object.keys(input).filter((key) => key !== 'sections' && key !== 'prefix');
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	if (input.sections === undefined)
		return { sections: [{ path: '/', label: 'Home', emoji: '🏠' }] };
	if (!Array.isArray(input.sections) || input.sections.length === 0)
		fail('`sections` must be a non-empty list.');
	const seen = new Set<string>();
	const sections = input.sections.map((s: unknown, i): Section => {
		const at = `\`sections[${i}]\``;
		if (!isRecord(s)) fail(`${at} must be an object.`);
		const extra = Object.keys(s).filter((k) => !['path', 'label', 'emoji', 'also'].includes(k));
		if (extra.length) fail(`${at} has unknown key \`${extra[0]}\`.`);
		if (!isPath(s.path))
			fail(`${at}.path must be an app path starting with "/" (no trailing slash, query or hash).`);
		if (typeof s.label !== 'string' || s.label.trim() === '')
			fail(`${at}.label must be a non-empty string.`);
		if (s.emoji !== undefined && typeof s.emoji !== 'string') fail(`${at}.emoji must be a string.`);
		const also = s.also ?? [];
		if (!Array.isArray(also) || !also.every((p) => isPath(p) && p !== '/'))
			fail(`${at}.also must be a list of app paths other than "/".`);
		for (const path of [s.path, ...also]) {
			if (seen.has(path)) fail(`${at} claims "${path}", which another section already has.`);
			seen.add(path);
		}
		return {
			path: s.path,
			label: s.label,
			...(s.emoji === undefined ? {} : { emoji: s.emoji }),
			...(also.length ? { also: [...also] } : {})
		};
	});
	return { sections };
}

/** How wider screens show the main navigation, per orientation (the `nav` setting). */
export type NavStyle = 'bar' | 'sidebar';
export type NavSetting = { portrait: NavStyle; landscape: NavStyle };
export const DEFAULT_NAV: NavSetting = { portrait: 'bar', landscape: 'sidebar' };

/** The saved `nav` setting, missing or bad halves back to their defaults. */
export function parseNav(raw: unknown): NavSetting | undefined {
	if (!isRecord(raw)) return undefined;
	const style = (v: unknown, fallback: NavStyle): NavStyle =>
		v === 'bar' || v === 'sidebar' ? v : fallback;
	return {
		portrait: style(raw.portrait, DEFAULT_NAV.portrait),
		landscape: style(raw.landscape, DEFAULT_NAV.landscape)
	};
}

/** Plain ES5 for the `nav` field's `prePaint`: `data-nav-portrait` / `data-nav-landscape`. */
export const APPLY_NAV =
	"var o=v&&typeof v==='object'?v:{};" +
	"root.setAttribute('data-nav-portrait',o.portrait==='sidebar'?'sidebar':'bar');" +
	"root.setAttribute('data-nav-landscape',o.landscape==='bar'?'bar':'sidebar');";

/** What `APPLY_NAV` does, for the page. */
export function applyNav(nav: NavSetting, root: HTMLElement): void {
	root.setAttribute('data-nav-portrait', nav.portrait);
	root.setAttribute('data-nav-landscape', nav.landscape);
}
