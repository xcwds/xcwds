import { describe, expect, it, vi } from 'vitest';
import {
	canShareFiles,
	fileName,
	saveFile,
	sharePhoto,
	sharePhotos,
	type ShareEnv
} from './share.js';

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

describe('sharePhotos', () => {
	it('shares several in one sheet, with distinct names for the same second', async () => {
		const env = shareEnv(async () => {});
		const later = takenAt + 60_000;
		const result = await sharePhotos(
			[
				{ blob: jpeg, takenAt },
				{ blob: jpeg, takenAt },
				{ blob: jpeg, takenAt: later }
			],
			env
		);
		expect(result).toBe('shared');
		const [[data]] = vi.mocked(env.navigator!.share).mock.calls as unknown as [[{ files: File[] }]];
		expect(data.files.map((f) => f.name)).toEqual([
			'photo-20261017-083005.jpg',
			'photo-20261017-083005-2.jpg',
			'photo-20261017-083105.jpg'
		]);
	});

	it('saves each where the sheet won’t take them, and does nothing for none', async () => {
		vi.useFakeTimers();
		const { env, clicked } = downloadEnv();
		env.navigator = {
			share: vi.fn(),
			canShare: vi.fn((data?: ShareData) => (data?.files?.length ?? 0) < 2)
		};
		expect(
			await sharePhotos(
				[
					{ blob: jpeg, takenAt },
					{ blob: jpeg, takenAt: takenAt + 1000 }
				],
				env
			)
		).toBe('saved');
		expect(clicked.map((c) => c.download)).toEqual([
			'photo-20261017-083005.jpg',
			'photo-20261017-083006.jpg'
		]);
		expect(await sharePhotos([], env)).toBe('cancelled');
		vi.useRealTimers();
	});
});
