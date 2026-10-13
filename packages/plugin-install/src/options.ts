/** The plugin's options, checked the same way in the build and the page. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-install';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.2.0';

/** The plugin has no options yet; this keeps the config honest about that. */
export type InstallOptions = Record<string, never>;

/** Where the head script keeps an install prompt that fires before the app starts. */
export const PROMPT_GLOBAL = '__xcwdsInstallPrompt';

/**
 * Plain ES5 for the head: holds on to Chromium's `beforeinstallprompt` if it fires before the
 * app's code has loaded, so the Install button can still use it.
 */
export const CATCH_PROMPT =
	"window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();" +
	`window.${PROMPT_GLOBAL}=e;});`;

/** Checks options as written in the config. */
export function resolveOptions(input: unknown = {}): InstallOptions {
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

/** iPhone, iPad or iPod, where there is no install prompt. iPadOS says it's a Mac with touch. */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
	return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** Running as the installed app (home screen), not in a browser tab. */
export function isStandalone(displayModeStandalone: boolean, navigatorStandalone: unknown) {
	return displayModeStandalone || navigatorStandalone === true;
}
