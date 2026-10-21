/**
 * Taking a recording out of the app (#150): the system share sheet where it can share files (Web
 * Share), otherwise a download. Leaving is always the person's own tap. Safe to import during
 * prerender: browser APIs are reached only when a function is called.
 */
import { extensionFor } from './format.js';

/** What these functions use of the browser; tests pass stand-ins. */
export interface ShareEnv {
	navigator?: Pick<Navigator, 'share' | 'canShare'>;
	document?: Pick<Document, 'createElement' | 'body'>;
	URL?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
}

export type ShareOutcome = 'shared' | 'saved' | 'cancelled' | 'failed';

export const SHARE_MESSAGES = {
	/** Said once, the first time a recording leaves the app. */
	outside:
		'Recordings you share or save are outside this app: wherever they go (your files, a chat) may keep or back them up.',
	failed: "The recording couldn't be shared or saved."
} as const;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A file name for a recording: its name, made safe for file systems, or else when it was
 * recorded, in local time (`recording-20261021-083005.webm`), with the extension for its type.
 */
export function fileName(recording: { name: string; recordedAt: number; type: string }): string {
	const safe = recording.name
		.normalize('NFC')
		// Characters file systems refuse, and control characters.
		// eslint-disable-next-line no-control-regex
		.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.slice(0, 80)
		.trim();
	const d = new Date(recording.recordedAt);
	const stamp = `recording-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
	return `${safe || stamp}.${extensionFor(recording.type)}`;
}

const nav = (env: ShareEnv) =>
	env.navigator ?? (typeof navigator === 'undefined' ? undefined : navigator);

/** Whether this browser can hand `file` to the share sheet; otherwise use Save. */
export function canShareFile(file: File, env: ShareEnv = {}): boolean {
	const n = nav(env);
	if (typeof n?.share !== 'function' || typeof n.canShare !== 'function') return false;
	try {
		return n.canShare({ files: [file] });
	} catch {
		return false;
	}
}

/** Whether this browser can share audio files at all (to label the button Share or Save). */
export function canShareAudio(env: ShareEnv = {}): boolean {
	return canShareFile(new File([], 'recording.m4a', { type: 'audio/mp4' }), env);
}

/** Downloads `file`: the fallback where Web Share can't take files (most computers). */
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
 * Shares a recording as a file (see `fileName`), or saves it where files can't be shared. Never
 * rejects: a dismissed share sheet is `cancelled`.
 */
export async function shareRecording(
	recording: { blob: Blob; name: string; recordedAt: number },
	env: ShareEnv = {}
): Promise<ShareOutcome> {
	const type = recording.blob.type || 'audio/webm';
	const file = new File([recording.blob], fileName({ ...recording, type }), { type });
	if (!canShareFile(file, env)) return saveFile(file, env);
	try {
		// Call it straight from the tap (Safari needs the tap's activation): no await before this.
		await nav(env)!.share({ files: [file] });
		return 'shared';
	} catch (e) {
		return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed';
	}
}
