import { describe, expect, it, vi } from 'vitest';
import { canShareAudio, fileName, shareRecording, type ShareEnv } from './share.js';

const TYPE = 'audio/webm;codecs=opus';
// 21 October 2026, 08:30:05 local time.
const recordedAt = new Date(2026, 9, 21, 8, 30, 5).getTime();

function downloadEnv() {
	const clicked: { href: string; download: string }[] = [];
	const env: ShareEnv = {
		document: {
			body: { append: vi.fn() } as unknown as HTMLElement,
			createElement: (() => {
				const link = {
					href: '',
					download: '',
					rel: '',
					click: () => clicked.push({ href: link.href, download: link.download }),
					remove: vi.fn()
				};
				return link;
			}) as unknown as Document['createElement']
		},
		URL: { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }
	};
	return { env, clicked };
}

const shareEnv = (share: () => Promise<void>, canShare = true): ShareEnv => ({
	navigator: { share: vi.fn(share), canShare: vi.fn(() => canShare) }
});

describe('fileName', () => {
	it('uses the name, made safe, or else when it was recorded, with its extension', () => {
		expect(fileName({ name: 'Shopping list', recordedAt, type: TYPE })).toBe('Shopping list.webm');
		expect(fileName({ name: '', recordedAt, type: 'audio/mp4' })).toBe(
			'recording-20261021-083005.m4a'
		);
		expect(fileName({ name: ' a/b:c?\n ', recordedAt, type: 'audio/ogg' })).toBe('a b c.ogg');
		expect(fileName({ name: '..', recordedAt, type: TYPE })).toBe('recording-20261021-083005.webm');
		expect(fileName({ name: 'x'.repeat(200), recordedAt, type: TYPE })).toHaveLength(85);
	});
});

describe('shareRecording', () => {
	const recording = { blob: new Blob(['a'], { type: TYPE }), name: 'Note', recordedAt };

	it('shares the file where the browser can', async () => {
		const env = shareEnv(async () => {});
		expect(canShareAudio(env)).toBe(true);
		expect(await shareRecording(recording, env)).toBe('shared');
		const [[data]] = vi.mocked(env.navigator!.share).mock.calls as [[ShareData]];
		expect(data.files![0]!.name).toBe('Note.webm');
		expect(data.files![0]!.type).toBe(TYPE);
	});

	it('says when the share sheet was dismissed or failed', async () => {
		const dismissed = shareEnv(async () => {
			throw new DOMException('no', 'AbortError');
		});
		expect(await shareRecording(recording, dismissed)).toBe('cancelled');
		const broken = shareEnv(async () => {
			throw new Error('no');
		});
		expect(await shareRecording(recording, broken)).toBe('failed');
	});

	it("downloads it where files can't be shared", async () => {
		const { env, clicked } = downloadEnv();
		expect(canShareAudio(env)).toBe(false);
		expect(await shareRecording(recording, { ...env, ...shareEnv(async () => {}, false) })).toBe(
			'saved'
		);
		expect(clicked).toEqual([{ href: 'blob:x', download: 'Note.webm' }]);
		expect(await shareRecording(recording, { navigator: {} as never })).toBe('failed');
	});
});
