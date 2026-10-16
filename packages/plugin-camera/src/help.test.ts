import { describe, expect, it } from 'vitest';
import { blockedHelp, browserOf, pinchZoom } from './help.js';

const UA = {
	iphoneSafari:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
	iphoneChrome:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
	iphoneFirefox:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/141.0 Mobile/15E148 Safari/605.1.15',
	ipadDesktop:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
	androidChrome:
		'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
	androidSamsung:
		'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
	androidFirefox: 'Mozilla/5.0 (Android 15; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0',
	windowsChrome:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
	windowsEdge:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.3351.95',
	linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0',
	macSafari:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
};

describe('browserOf', () => {
	it('tells where the camera setting lives', () => {
		expect(browserOf({ userAgent: UA.iphoneSafari })).toBe('ios-safari');
		expect(browserOf({ userAgent: UA.iphoneSafari, standalone: true })).toBe('ios-app');
		expect(browserOf({ userAgent: UA.iphoneChrome })).toBe('ios-other');
		expect(browserOf({ userAgent: UA.iphoneFirefox })).toBe('ios-other');
		// An iPad asking for the desktop site says it's a Mac; its touch screen gives it away.
		expect(browserOf({ userAgent: UA.ipadDesktop, touchPoints: 5 })).toBe('ios-safari');
		expect(browserOf({ userAgent: UA.macSafari, touchPoints: 0 })).toBe('desktop-safari');
		expect(browserOf({ userAgent: UA.androidChrome })).toBe('android-chromium');
		expect(browserOf({ userAgent: UA.androidSamsung })).toBe('android-chromium');
		expect(browserOf({ userAgent: UA.androidFirefox })).toBe('android-firefox');
		expect(browserOf({ userAgent: UA.windowsChrome })).toBe('desktop-chromium');
		expect(browserOf({ userAgent: UA.windowsEdge })).toBe('desktop-chromium');
		expect(browserOf({ userAgent: UA.linuxFirefox })).toBe('desktop-firefox');
		expect(browserOf({ userAgent: '' })).toBe('other');
	});

	it('gives each its own steps', () => {
		expect(blockedHelp({ userAgent: UA.iphoneSafari })).toMatch(/aA button.*Website Settings/);
		expect(blockedHelp({ userAgent: UA.iphoneSafari, standalone: true })).toMatch(
			/Settings app.*Safari → Camera/
		);
		expect(blockedHelp({ userAgent: UA.androidChrome })).toMatch(/Permissions.*Android's Settings/);
		expect(blockedHelp({ userAgent: UA.linuxFirefox })).toMatch(/crossed-out camera/);
		expect(blockedHelp({ userAgent: UA.macSafari })).toMatch(/Safari → Settings → Websites/);
		expect(blockedHelp({ userAgent: 'curl/8' })).toMatch(/browser's settings/);
	});
});

describe('pinchZoom', () => {
	const zoom = { kind: 'digital' as const, min: 1, max: 1.4, step: 0.1, value: 1 };

	it('scales the starting zoom by the spread, within range and on steps', () => {
		expect(pinchZoom(1, 100, 120, zoom)).toBe(1.2);
		expect(pinchZoom(1.2, 100, 50, zoom)).toBe(1);
		expect(pinchZoom(1, 100, 400, zoom)).toBe(1.4);
		expect(pinchZoom(1, 100, 113, zoom)).toBe(1.1);
		const hardware = { kind: 'hardware' as const, min: 1, max: 10, step: 0.5, value: 2 };
		expect(pinchZoom(2, 100, 230, hardware)).toBe(4.5);
	});

	it('keeps the zoom for a pinch with no spread', () => {
		expect(pinchZoom(1, 0, 120, { ...zoom, value: 1.3 })).toBe(1.3);
		expect(pinchZoom(1, 100, Number.NaN, { ...zoom, value: 1.3 })).toBe(1.3);
	});
});
