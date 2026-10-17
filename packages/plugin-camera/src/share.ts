/**
 * Taking a photo out of the app (#146): the system share sheet where it can share files (Web
 * Share), otherwise a download. Leaving is always the person's own tap. Safe to import during
 * prerender: browser APIs are reached only when a function is called.
 */

/** What these functions use of the browser; tests pass stand-ins. */
export interface ShareEnv {
	navigator?: Pick<Navigator, 'share' | 'canShare'>;
	document?: Pick<Document, 'createElement' | 'body'>;
	URL?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
}

export type ShareOutcome = 'shared' | 'saved' | 'cancelled' | 'failed';

export const SHARE_MESSAGES = {
	/** Said once, the first time a photo leaves the app. */
	outside:
		'Photos you share or save are outside this app: wherever they go (your gallery, a chat) may keep or back them up.',
	failed: "The photo couldn't be shared or saved."
} as const;

const EXTENSIONS: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/png': 'png'
};

const pad = (n: number) => String(n).padStart(2, '0');

/** A file name from when the photo was taken, in local time: `photo-20261017-083005.jpg`. */
export function fileName(photo: { takenAt: number; type: string }): string {
	const d = new Date(photo.takenAt);
	const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
	return `photo-${stamp}.${EXTENSIONS[photo.type] ?? 'jpg'}`;
}

const nav = (env: ShareEnv) =>
	env.navigator ?? (typeof navigator === 'undefined' ? undefined : navigator);

/** Whether this browser can hand image files to the share sheet; otherwise use Save. */
export function canShareFiles(env: ShareEnv = {}): boolean {
	const n = nav(env);
	if (typeof n?.share !== 'function' || typeof n.canShare !== 'function') return false;
	try {
		return n.canShare({ files: [new File([], 'photo.jpg', { type: 'image/jpeg' })] });
	} catch {
		return false;
	}
}

/** Downloads `file`: the fallback where Web Share can't take files (Firefox on computers, say). */
export function saveFile(file: File, env: ShareEnv = {}): ShareOutcome {
	const doc = env.document ?? (typeof document === 'undefined' ? undefined : document);
	const urls = env.URL ?? URL;
	if (!doc?.body) return 'failed';
	const url = urls.createObjectURL(file);
	try {
		const link = doc.createElement('a');
		link.href = url;
		link.download = file.name;
		link.rel = 'noopener';
		doc.body.append(link);
		link.click();
		link.remove();
		return 'saved';
	} catch {
		return 'failed';
	} finally {
		// After the click has started the download.
		setTimeout(() => urls.revokeObjectURL(url), 1000);
	}
}

/**
 * Shares `blob` as a file named for when it was taken, or saves it where files can't be shared.
 * Never rejects: a dismissed share sheet is `cancelled`.
 */
export function sharePhoto(
	photo: { blob: Blob; takenAt: number },
	env: ShareEnv = {}
): Promise<ShareOutcome> {
	return sharePhotos([photo], env);
}

/**
 * Shares several photos in one share sheet, or saves each where files can't be shared (or where
 * the browser won't take this many at once). Files taken in the same second get `-2`, `-3`…
 * Never rejects.
 */
export async function sharePhotos(
	photos: readonly { blob: Blob; takenAt: number }[],
	env: ShareEnv = {}
): Promise<ShareOutcome> {
	if (!photos.length) return 'cancelled';
	const used: Record<string, number> = {};
	const files = photos.map((photo) => {
		const type = photo.blob.type || 'image/jpeg';
		let name = fileName({ takenAt: photo.takenAt, type });
		const seen = (used[name] = (used[name] ?? 0) + 1);
		if (seen > 1) name = name.replace(/(\.\w+)$/, `-${seen}$1`);
		return new File([photo.blob], name, { type });
	});
	const n = nav(env);
	let can: boolean;
	try {
		can = canShareFiles(env) && n!.canShare({ files });
	} catch {
		can = false;
	}
	if (!can) {
		const outcomes = files.map((file) => saveFile(file, env));
		return outcomes.includes('failed') ? 'failed' : 'saved';
	}
	try {
		// Call it straight from the tap (Safari needs the tap's activation): no await before this.
		await n!.share({ files });
		return 'shared';
	} catch (e) {
		return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed';
	}
}
