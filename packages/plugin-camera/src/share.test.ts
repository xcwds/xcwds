import { describe, expect, it, vi } from 'vitest';
import { canShareFiles, fileName, saveFile, sharePhoto, type ShareEnv } from './share.js';

const jpeg = new Blob(['x'], { type: 'image/jpeg' });
// 17 October 2026, 08:30:05 local time.
const takenAt = new Date(2026, 9, 17, 8, 30, 5).getTime();

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

function shareEnv(share: () => Promise<void>, canShare = true) {
	const env: ShareEnv = { navigator: { share: vi.fn(share), canShare: vi.fn(() => canShare) } };
	return env;
}

describe('fileName', () => {
	it('names the file for when it was taken, with the right extension', () => {
		expect(fileName({ takenAt, type: 'image/jpeg' })).toBe('photo-20261017-083005.jpg');
		expect(fileName({ takenAt, type: 'image/webp' })).toBe('photo-20261017-083005.webp');
		expect(fileName({ takenAt, type: '' })).toBe('photo-20261017-083005.jpg');
	});
});

describe('canShareFiles', () => {
	it('needs both share and canShare saying yes to files', () => {
		expect(canShareFiles(shareEnv(async () => {}))).toBe(true);
		expect(canShareFiles(shareEnv(async () => {}, false))).toBe(false);
		expect(canShareFiles({ navigator: { canShare: () => true } as never })).toBe(false);
		const throws = {
			navigator: {
				share: vi.fn(),
				canShare: () => {
					throw new TypeError();
				}
			}
		};
		expect(canShareFiles(throws as never)).toBe(false);
	});
});

describe('sharePhoto', () => {
	it('shares the photo as a named file', async () => {
		const env = shareEnv(async () => {});
		expect(await sharePhoto({ blob: jpeg, takenAt }, env)).toBe('shared');
		const [[data]] = vi.mocked(env.navigator!.share).mock.calls as unknown as [[{ files: File[] }]];
		expect(data.files[0]!.name).toBe('photo-20261017-083005.jpg');
		expect(data.files[0]!.type).toBe('image/jpeg');
		expect(await data.files[0]!.text()).toBe('x');
	});

	it('a dismissed share sheet is cancelled, other errors fail', async () => {
		const abort = shareEnv(() => Promise.reject(new DOMException('no', 'AbortError')));
		expect(await sharePhoto({ blob: jpeg, takenAt }, abort)).toBe('cancelled');
		const denied = shareEnv(() => Promise.reject(new DOMException('no', 'NotAllowedError')));
		expect(await sharePhoto({ blob: jpeg, takenAt }, denied)).toBe('failed');
	});

	it('saves a download where files can’t be shared', async () => {
		vi.useFakeTimers();
		const { env, clicked } = downloadEnv();
		env.navigator = { share: vi.fn(), canShare: () => false };
		expect(await sharePhoto({ blob: jpeg, takenAt }, env)).toBe('saved');
		expect(env.navigator.share).not.toHaveBeenCalled();
		expect(clicked).toEqual([{ href: 'blob:x', download: 'photo-20261017-083005.jpg' }]);
		// The URL is let go once the download has started.
		expect(env.URL!.revokeObjectURL).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1000);
		expect(env.URL!.revokeObjectURL).toHaveBeenCalledWith('blob:x');
		vi.useRealTimers();
	});

	it('fails without a page to download from', () => {
		expect(saveFile(new File([], 'a.jpg'), { document: {} as never })).toBe('failed');
	});
});
