/**
 * `@xcwds/plugin-scanner/share`: taking a scan out of the app (#151), as one PDF or as its page
 * images, through the system share sheet where it can share files (Web Share), otherwise as a
 * download. Leaving is always the person's own tap. Safe to import during prerender: browser APIs
 * are reached only when a function is called.
 *
 * Making the files reads every page and can take a moment, and Safari opens the share sheet only
 * straight from a tap. So make them first (`scanPdf`, `scanImages`: when the pages change, or when
 * an Export panel opens), then call `shareFiles` from the tap with the files already made.
 */
import type { Paper } from './geometry.js';
import type { Pages } from './pages.js';
import { jpegInfo, stripJpeg, writePdf } from './pdf.js';

/** What these functions use of the browser; tests pass stand-ins. */
export interface ShareEnv {
	navigator?: Pick<Navigator, 'share' | 'canShare'>;
	document?: Pick<Document, 'createElement' | 'body'>;
	URL?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
}

export type ShareOutcome = 'shared' | 'saved' | 'cancelled' | 'failed';

export const SHARE_MESSAGES = {
	/** Said once, the first time a scan leaves the app. */
	outside:
		'Scans you share or save are outside this app: wherever they go (your files, a chat, a printer app) may keep or back them up.',
	failed: "The scan couldn't be shared or saved.",
	empty: 'There are no pages to share yet.',
	/** For a page whose saved image can't be read (`{n}` is its number, from 1). */
	page: "Page {n} couldn't be read. Retake it or delete it, then try again."
} as const;

export type FilesResult = { ok: true; files: File[] } | { ok: false; error: string };

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A file name for a scan from when it was made, in local time: `scan-20261027-090142.pdf`, or
 * `scan-20261027-090142-2.jpg` for its second page as an image.
 */
export function fileName(scannedAt: number, type: 'pdf' | 'jpg', page?: number): string {
	const d = new Date(scannedAt);
	const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
	return `scan-${stamp}${page === undefined ? '' : `-${page}`}.${type}`;
}

export interface ScanFileOptions {
	/** When the scan was made, for the file name, in ms since the epoch. Default now. */
	scannedAt?: number;
}

export interface ScanPdfOptions extends ScanFileOptions {
	/** A4 (the default) or Letter. */
	paper?: Paper;
}

/** `scannedAt`, or now when it isn't a time a file can be named for. */
const when = (options: ScanFileOptions) =>
	Number.isFinite(options.scannedAt) ? options.scannedAt! : Date.now();

/**
 * Each page's JPEG, in order, stripped of metadata (`stripJpeg`), or the error to show: no pages,
 * or a page that isn't a JPEG `writePdf` can embed.
 */
async function readPages(pages: Pick<Pages, 'jpegs'>): Promise<Uint8Array[] | string> {
	const jpegs = await pages.jpegs();
	if (!jpegs.length) return SHARE_MESSAGES.empty;
	const out: Uint8Array[] = [];
	for (const [n, bytes] of jpegs.entries()) {
		const jpeg = stripJpeg(bytes);
		if (!jpeg || !jpegInfo(jpeg)) return SHARE_MESSAGES.page.replace('{n}', String(n + 1));
		out.push(jpeg);
	}
	return out;
}

/**
 * The scan as one PDF file (`writePdf`), one page per page of the scan, in order. Throws a
 * `RangeError` for a `paper` that isn't `a4` or `letter`, as `writePdf` does.
 */
export async function scanPdf(
	pages: Pick<Pages, 'jpegs'>,
	options: ScanPdfOptions = {}
): Promise<FilesResult> {
	const jpegs = await readPages(pages);
	if (typeof jpegs === 'string') return { ok: false, error: jpegs };
	const pdf = writePdf(jpegs, { paper: options.paper ?? 'a4' });
	const name = fileName(when(options), 'pdf');
	return { ok: true, files: [new File([pdf as BlobPart], name, { type: 'application/pdf' })] };
}

/**
 * The scan's pages as JPEG files, in order (numbered from 1), with no metadata, for people who
 * want images rather than a PDF.
 */
export async function scanImages(
	pages: Pick<Pages, 'jpegs'>,
	options: ScanFileOptions = {}
): Promise<FilesResult> {
	const jpegs = await readPages(pages);
	if (typeof jpegs === 'string') return { ok: false, error: jpegs };
	const at = when(options);
	const files = jpegs.map(
		(jpeg, n) => new File([jpeg as BlobPart], fileName(at, 'jpg', n + 1), { type: 'image/jpeg' })
	);
	return { ok: true, files };
}

/** What a scan leaves the app as: one PDF, or one JPEG per page. */
export type ScanFormat = 'pdf' | 'images';

export interface ScanFilesOptions extends ScanPdfOptions {
	/** Default `pdf`. */
	format?: ScanFormat;
}

/**
 * The scan as `format` asks: `scanPdf` (with `paper`) or `scanImages`. Rejects with a
 * `RangeError` for another `format`, or for a `paper` that isn't `a4` or `letter`.
 */
export async function scanFiles(
	pages: Pick<Pages, 'jpegs'>,
	{ format = 'pdf', ...options }: ScanFilesOptions = {}
): Promise<FilesResult> {
	if (format === 'pdf') return scanPdf(pages, options);
	if (format === 'images') {
		return scanImages(pages, options);
	}
	throw new RangeError(`A scan's format must be pdf or images, not ${String(format)}.`);
}

/**
 * When a scan was made, for its file names: when its first page still there was saved (a retake
 * counts as saving it again), or now when it has no pages.
 */
export function scannedAt(pages: readonly { saved: number }[]): number {
	const times = pages.map((p) => p.saved).filter(Number.isFinite);
	return times.length ? Math.min(...times) : Date.now();
}

const nav = (env: ShareEnv) =>
	env.navigator ?? (typeof navigator === 'undefined' ? undefined : navigator);

/** Whether this browser can hand `files` to the share sheet; otherwise `shareFiles` saves them. */
export function canShareFiles(files: readonly File[], env: ShareEnv = {}): boolean {
	const n = nav(env);
	if (typeof n?.share !== 'function' || typeof n.canShare !== 'function') return false;
	try {
		return n.canShare({ files: [...files] });
	} catch {
		return false;
	}
}

/** Whether this browser can share a PDF at all (to label the button Share or Save). */
export function canSharePdf(env: ShareEnv = {}): boolean {
	return canShareFiles([new File([], 'scan.pdf', { type: 'application/pdf' })], env);
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
 * Shares `files` (from `scanPdf` or `scanImages`) in one share sheet, or saves each where the
 * browser can't share them (or not this many at once). Call it straight from the tap. Never
 * rejects: a dismissed share sheet is `cancelled`.
 */
export async function shareFiles(
	files: readonly File[],
	env: ShareEnv = {}
): Promise<ShareOutcome> {
	if (!files.length) return 'cancelled';
	if (!canShareFiles(files, env)) {
		const outcomes = files.map((file) => saveFile(file, env));
		return outcomes.includes('failed') ? 'failed' : 'saved';
	}
	try {
		// Safari needs the tap's activation: no await before this.
		await nav(env)!.share({ files: [...files] });
		return 'shared';
	} catch (e) {
		return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed';
	}
}
