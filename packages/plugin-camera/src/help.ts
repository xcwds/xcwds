/**
 * Help for a blocked camera (#145): where each browser keeps the setting that unblocks it, worked
 * out from the user agent. A page can't open those settings or ask again once the camera is
 * blocked, so the most it can do is say where to look. Also the arithmetic for pinch to zoom.
 */
import type { Zoom } from './camera.js';

export type Browser =
	| 'ios-safari'
	| 'ios-app'
	| 'ios-other'
	| 'android-chromium'
	| 'android-firefox'
	| 'desktop-chromium'
	| 'desktop-firefox'
	| 'desktop-safari'
	| 'other';

export interface Device {
	userAgent: string;
	/** `navigator.maxTouchPoints`: an iPad asks for the desktop site with a Mac's user agent. */
	touchPoints?: number;
	/** Opened from the Home Screen (`display-mode: standalone`). */
	standalone?: boolean;
}

/** Which family of browser `device` is, for where its camera setting lives. */
export function browserOf({ userAgent: ua, touchPoints = 0, standalone = false }: Device): Browser {
	const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
	if (ios) {
		if (standalone) return 'ios-app';
		// Every iOS browser is WebKit, but Chrome, Firefox and Edge keep the camera in iOS Settings.
		return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios-safari';
	}
	if (/Android/.test(ua)) return /Firefox\//.test(ua) ? 'android-firefox' : 'android-chromium';
	if (/Firefox\//.test(ua)) return 'desktop-firefox';
	if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'desktop-chromium';
	if (/Safari\//.test(ua) && /Macintosh/.test(ua)) return 'desktop-safari';
	return 'other';
}

const MAC = ' On a Mac, also check System Settings → Privacy & Security → Camera.';
const ANDROID =
	" If it's still blocked, allow the camera for this browser in Android's Settings → Apps.";

const HELP: Record<Browser, string> = {
	'ios-safari':
		'Tap the aA button in the address bar, then Website Settings, and set Camera to Allow. Then try again.',
	'ios-app':
		'Open the Settings app, go to Apps → Safari → Camera, and choose Ask or Allow. Then close this app and open it again.',
	'ios-other':
		'Open the Settings app, find this browser in the list of apps, and turn on Camera. Then reload this page.',
	'android-chromium':
		'Tap the icon to the left of the address, then Permissions, and turn on Camera. Then try again.' +
		ANDROID,
	'android-firefox':
		'Tap the lock icon in the address bar and turn on Camera. Then try again.' + ANDROID,
	'desktop-chromium':
		'Click the icon to the left of the address, set Camera to Allow, then try again.' + MAC,
	'desktop-firefox':
		'Click the crossed-out camera icon in the address bar, clear the block on the camera, then try again.' +
		MAC,
	'desktop-safari':
		'Choose Safari → Settings → Websites → Camera and set this site to Allow, then try again.' +
		MAC,
	other:
		"Look for this site's permissions in your browser's settings, allow the camera, then try again."
};

/** Where to unblock the camera in `device`'s browser, as sentences to show. */
export function blockedHelp(device: Device): string {
	return HELP[browserOf(device)];
}

/** The device the page runs on, for `blockedHelp`. Call it in the page, not at import. */
export function thisDevice(): Device {
	return {
		userAgent: navigator.userAgent,
		touchPoints: navigator.maxTouchPoints ?? 0,
		standalone:
			matchMedia?.('(display-mode: standalone)').matches ||
			(navigator as { standalone?: boolean }).standalone === true
	};
}

/**
 * The zoom a pinch asks for: the zoom when the fingers went down, scaled by how far apart they
 * are now against then, kept in range and on the zoom's steps.
 */
export function pinchZoom(start: number, from: number, to: number, zoom: Zoom): number {
	if (!(from > 0) || !(to > 0)) return zoom.value;
	const wanted = Math.min(zoom.max, Math.max(zoom.min, start * (to / from)));
	const step = zoom.step > 0 ? zoom.step : 0.1;
	const stepped = zoom.min + Math.round((wanted - zoom.min) / step) * step;
	return Number(Math.min(zoom.max, stepped).toFixed(6));
}
