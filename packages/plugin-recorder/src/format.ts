/**
 * Which audio format to record in (#150). Browsers differ: Chromium records WebM, Firefox WebM or
 * Ogg, Safari MP4, and each says which it can through `MediaRecorder.isTypeSupported`. All three
 * are Opus or AAC, which suit voice. Safe to import during prerender: nothing here touches the
 * browser.
 */

export type Format = {
	/** What to pass as `mimeType` to `MediaRecorder`. */
	type: string;
	/** A file extension for downloads and shares. */
	extension: string;
};

/** In order of preference: the first one the browser can record is used. */
export const FORMATS: readonly Format[] = [
	{ type: 'audio/webm;codecs=opus', extension: 'webm' },
	{ type: 'audio/ogg;codecs=opus', extension: 'ogg' },
	{ type: 'audio/mp4', extension: 'm4a' }
];

/**
 * The first of `FORMATS` that `isTypeSupported` accepts, or undefined to let the browser pick
 * (one without `isTypeSupported`, or that accepts none of them). A check that throws counts as no.
 */
export function pickFormat(isTypeSupported?: (type: string) => boolean): Format | undefined {
	if (typeof isTypeSupported !== 'function') return undefined;
	return FORMATS.find((format) => {
		try {
			return isTypeSupported(format.type) === true;
		} catch {
			return false;
		}
	});
}

/**
 * A file extension for a recording of `type` (what the recorder actually wrote, which can differ
 * from what was asked for), or `audio` when it's none of ours.
 */
export function extensionFor(type: string): string {
	const base = type.split(';')[0]!.trim().toLowerCase();
	if (base === 'audio/webm' || base === 'video/webm') return 'webm';
	if (base === 'audio/ogg') return 'ogg';
	if (base === 'audio/mp4' || base === 'video/mp4' || base === 'audio/x-m4a') return 'm4a';
	return 'audio';
}
