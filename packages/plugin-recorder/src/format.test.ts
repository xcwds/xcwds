import { describe, expect, it } from 'vitest';
import { FORMATS, extensionFor, pickFormat } from './format.js';

describe('pickFormat', () => {
	it("picks each browser's format", () => {
		const supports = (types: string[]) => (type: string) => types.includes(type);
		// Chromium and Firefox: WebM.
		expect(pickFormat(supports(['audio/webm;codecs=opus', 'audio/ogg;codecs=opus']))).toEqual(
			FORMATS[0]
		);
		// Firefox without WebM: Ogg.
		expect(pickFormat(supports(['audio/ogg;codecs=opus']))?.extension).toBe('ogg');
		// Safari: MP4.
		expect(pickFormat(supports(['audio/mp4']))?.extension).toBe('m4a');
	});

	it("lets the browser pick when it can't say, or says no to all", () => {
		expect(pickFormat(undefined)).toBeUndefined();
		expect(pickFormat(() => false)).toBeUndefined();
		expect(
			pickFormat(() => {
				throw new Error('no');
			})
		).toBeUndefined();
	});
});

describe('extensionFor', () => {
	it('names what the recorder actually wrote', () => {
		expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
		expect(extensionFor('audio/ogg; codecs=opus')).toBe('ogg');
		expect(extensionFor('audio/mp4')).toBe('m4a');
		expect(extensionFor('video/mp4')).toBe('m4a');
		expect(extensionFor('')).toBe('audio');
	});
});
