/** The plugin's options, checked the same way in the build and the page. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-install';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.5.0';

/** The install card's words. `<strong>` is kept in the steps and `menu`; other markup is text. */
export type InstallText = {
	heading: string;
	intro: string;
	/** The Install button. */
	install: string;
	/** iPhone and iPad steps. */
	iosSteps: string[];
	/** Other browsers. */
	menu: string;
};

export type InstallOptions = {
	/** The words on every install card (the settings page's too); any left out keep their defaults. */
	text?: Partial<InstallText>;
};

export type ResolvedInstallOptions = { text: Partial<InstallText> };

const TEXT_KEYS = ['heading', 'intro', 'install', 'iosSteps', 'menu'];

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
export function resolveOptions(input: unknown = {}): ResolvedInstallOptions {
	if (!isObject(input)) fail('options must be an object.');
	const unknown = Object.keys(input).filter((key) => key !== 'prefix' && key !== 'text');
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const text = input.text ?? {};
	if (!isObject(text)) fail('`text` must be an object.');
	const extra = Object.keys(text).filter((key) => !TEXT_KEYS.includes(key));
	if (extra.length) fail(`unknown \`text\` key ${extra.map((k) => `\`${k}\``).join(', ')}.`);
	for (const key of ['heading', 'intro', 'install', 'menu'])
		if (text[key] !== undefined && !words(text[key])) fail(`\`text.${key}\` must be a string.`);
	const steps = text.iosSteps;
	if (steps !== undefined && (!Array.isArray(steps) || !steps.length || !steps.every(words)))
		fail('`text.iosSteps` must be a list of steps.');
	return { text: { ...text, ...(steps ? { iosSteps: [...steps] } : {}) } };
}

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const words = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** iPhone, iPad or iPod, where there is no install prompt. iPadOS says it's a Mac with touch. */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
	return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** Running as the installed app (home screen), not in a browser tab. */
export function isStandalone(displayModeStandalone: boolean, navigatorStandalone: unknown) {
	return displayModeStandalone || navigatorStandalone === true;
}
