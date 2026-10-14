/** The plugin's options, checked the same way in the build and the page. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-theme';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.3.0';

export type Theme = 'system' | 'light' | 'dark';
export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

export type ThemeOptions = {
	/** The theme until the user picks one. Defaults to `system` (follow the OS). */
	default?: Theme;
};

export type ResolvedThemeOptions = Required<ThemeOptions>;

/** Where the build leaves the brand's theme colours for the page (set by the head script). */
export const COLORS_GLOBAL = '__xcwdsThemeColor';

export const isTheme = (v: unknown): v is Theme => THEMES.includes(v as Theme);

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

/** Checks options as written in the config and fills in the defaults. */
export function resolveOptions(input: unknown = {}): ResolvedThemeOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const options = input as Record<string, unknown>;
	const unknown = Object.keys(options).filter((key) => key !== 'default' && key !== 'prefix');
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const theme = options.default ?? 'system';
	if (!isTheme(theme)) fail('`default` must be "system", "light" or "dark".');
	return { default: theme };
}

/** The colour scheme a theme shows. */
export function resolveScheme(theme: Theme, prefersDark: boolean): 'light' | 'dark' {
	return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
}

/**
 * Plain ES5 for the `theme` field's `prePaint`: sets
 * `data-color-scheme` and `color-scheme` on `<html>`, and the browser bar colour. `v` is the
 * saved theme and `root` is `<html>`.
 */
export const APPLY =
	"var t=v==='light'||v==='dark'?v:'system';" +
	"var d=t==='dark'||(t==='system'&&!!window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);" +
	"var s=d?'dark':'light';root.setAttribute('data-color-scheme',s);root.style.colorScheme=s;" +
	`var c=window.${COLORS_GLOBAL},m=document.querySelector('meta[name="theme-color"]');` +
	'if(c&&m&&c[s])m.setAttribute("content",c[s]);';

/**
 * What `APPLY` does, for the page (which can't `eval` it under a strict CSP). The tests check
 * the two agree.
 */
export function applyTheme(
	theme: unknown,
	root: HTMLElement,
	{
		prefersDark,
		colors
	}: { prefersDark: boolean; colors?: Partial<Record<'light' | 'dark', string>> }
): 'light' | 'dark' {
	const scheme = resolveScheme(isTheme(theme) ? theme : 'system', prefersDark);
	root.setAttribute('data-color-scheme', scheme);
	root.style.colorScheme = scheme;
	const color = colors?.[scheme];
	if (color)
		root.ownerDocument.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
	return scheme;
}
