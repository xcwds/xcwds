/** The plugin's options, checked the same way in the build, the page and the worker. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-share';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.5.0';

export type ShareOptions = {
	/**
	 * The page that receives shares from other apps (Android's share sheet, via the manifest's
	 * `share_target`), e.g. `/utils/url-sanitizer`. Without it the app is no share target.
	 */
	target?: string;
	/** Paths (and everything under them) whose page never shows the Share button. */
	exclude?: string[];
	/**
	 * Receives shared images too (#148). The manifest's `share_target` then sends every share by
	 * POST to `files.target`, which the worker answers on the device. Before the worker runs (right
	 * after install, or after the site's data was cleared), that POST uploads the image to the server
	 * the app is loaded from, so this needs `allowColdStartRisk: true`.
	 */
	files?: ShareFilesOptions;
};

export type ShareFilesOptions = {
	/** The page that receives shared images (an app path); may be the same as `target`. */
	target: string;
	/** Image types to accept, e.g. `image/jpeg` or `image/*` (the default). */
	accept?: string[];
	/**
	 * Must be `true`: you accept that a share made before the service worker runs reaches the
	 * server, image included. Settings → Privacy says so.
	 */
	allowColdStartRisk: true;
};

export type ResolvedShareOptions = {
	target: string | null;
	exclude: string[];
	files: { target: string; accept: string[] } | null;
};

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

const isPath = (v: unknown): v is string =>
	typeof v === 'string' && v.startsWith('/') && !/[?#]/.test(v) && (v === '/' || !v.endsWith('/'));

/** Checks options as written in the config and fills in the defaults. */
export function resolveOptions(input: unknown = {}): ResolvedShareOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const options = input as Record<string, unknown>;
	const unknown = Object.keys(options).filter(
		(k) => !['target', 'exclude', 'files', 'prefix'].includes(k)
	);
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const target = options.target ?? null;
	if (target !== null && (!isPath(target) || target === '/'))
		fail('`target` must be an app path other than "/" (no trailing slash, query or hash).');
	const exclude = options.exclude ?? ['/settings'];
	if (!Array.isArray(exclude) || !exclude.every(isPath))
		fail('`exclude` must be a list of app paths starting with "/".');
	return { target, exclude: [...exclude], files: resolveFiles(options.files) };
}

/** `image/<subtype>` or `image/*`: images only (#148). */
const isImageType = (v: unknown): v is string =>
	typeof v === 'string' && /^image\/(\*|[a-z0-9][a-z0-9.+-]*)$/.test(v);

function resolveFiles(input: unknown): ResolvedShareOptions['files'] {
	if (input === undefined) return null;
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('`files` must be an object.');
	const files = input as Record<string, unknown>;
	const unknown = Object.keys(files).filter(
		(k) => !['target', 'accept', 'allowColdStartRisk'].includes(k)
	);
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`files.${k}\``).join(', ')}.`);
	if (!isPath(files.target) || files.target === '/')
		fail('`files.target` must be an app path other than "/" (no trailing slash, query or hash).');
	const accept = files.accept ?? ['image/*'];
	if (!Array.isArray(accept) || accept.length === 0 || !accept.every(isImageType))
		fail('`files.accept` must be a list of image types, like "image/jpeg" or "image/*".');
	if (files.allowColdStartRisk !== true)
		fail(
			"`files` needs `allowColdStartRisk: true`. A share made before the service worker runs (right after install, or after the site's data was cleared) uploads the image to the server the app is loaded from."
		);
	return { target: files.target, accept: [...accept] };
}

/** Whether a file's type is one `accept` lists (`image/*` takes any image). */
export function accepts(accept: readonly string[], type: string): boolean {
	const t = type.toLowerCase();
	return accept.some((a) => (a.endsWith('/*') ? t.startsWith(a.slice(0, -1)) : t === a));
}

/** The form field shared files arrive in (`share_target.params.files[].name`). */
export const FILES_FIELD = 'files';

/** What the inbox keeps with each shared file: its name. */
export type InboxMeta = { name: string };

/**
 * Where the worker keeps shared files until the target page takes them (`app:share:inbox`):
 * personal, out of backups, and emptied as the page reads them (or after a day).
 */
export const INBOX = {
	key: 'inbox',
	label: 'Shared images',
	sensitive: true,
	backup: false,
	validate: (raw: unknown): InboxMeta | undefined => {
		const name = (raw as InboxMeta | null)?.name;
		return typeof name === 'string' ? { name: name.slice(0, 255) } : undefined;
	}
} as const;

/** How long the inbox keeps a file no page took. */
export const INBOX_MAX_AGE = 24 * 60 * 60 * 1000;

/** The fields a share sheet sends (the manifest's `share_target.params`). */
export const FIELDS = ['url', 'text', 'title'] as const;

/** What another app shared. */
export type Shared = {
	/**
	 * Everything shared, joined with spaces (url, text, title): share sheets often put the link
	 * in `text`, so look for it here. From the iPhone Shortcut (`#url=…`), the shared link.
	 */
	joined: string;
	url?: string;
	text?: string;
	title?: string;
	/** Shared images (with `files`), handed over by `app.shared.listen` and then deleted. */
	files?: File[];
	/** How many shared files weren't kept: not an accepted type, or they couldn't be saved. */
	skipped?: number;
};

/** The files a share carried, as the worker's redirect names them: their ids in the inbox. */
export type SharedFiles = { ids: string[]; skipped: number };

/** The shared fields from a query string (`?url=…&text=…&title=…`), or null if none. */
export function fromQuery(params: URLSearchParams | FormData): Shared | null {
	const fields: Partial<Record<(typeof FIELDS)[number], string>> = {};
	for (const key of FIELDS) {
		const raw = params.get(key);
		const value = typeof raw === 'string' ? raw.trim() : undefined;
		if (value) fields[key] = value;
	}
	const parts = FIELDS.map((key) => fields[key]).filter((v): v is string => !!v);
	return parts.length ? { joined: parts.join(' '), ...fields } : null;
}

/** Decodes the shared link, keeping it as written when it isn't valid percent-encoding. */
function decodeLink(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/**
 * The fragment a share moves to: each field as `shared.<name>=` (shared files as their inbox ids,
 * `shared.files=<id>,<id>`), then `url=<joined>` last. The iPhone Shortcut opens `#url=<link>`
 * directly, and may not encode `&` or `+` in the link, so everything after `url=` is the link,
 * decoded whole (never split or read as form data).
 */
export function toFragment(shared: Shared, files?: SharedFiles): string {
	const params = new URLSearchParams();
	for (const key of FIELDS) {
		const value = shared[key];
		if (value) params.set(`shared.${key}`, value);
	}
	if (files?.ids.length) params.set('shared.files', files.ids.join(','));
	if (files?.skipped) params.set('shared.skipped', String(files.skipped));
	const fields = params.toString();
	return `#${fields ? `${fields}&` : ''}url=${encodeURIComponent(shared.joined)}`;
}

/** What a target page's fragment holds, or null when it isn't a share. */
export function fromFragment(hash: string): Shared | null {
	let prefix = '';
	let link: string;
	if (hash.startsWith('#url=')) link = hash.slice('#url='.length);
	else if (hash.startsWith('#shared.') && hash.includes('&url=')) {
		const at = hash.indexOf('&url=');
		prefix = hash.slice(1, at);
		link = hash.slice(at + '&url='.length);
	} else return null;
	const joined = decodeLink(link).trim();
	const params = new URLSearchParams(prefix);
	const files = filesOf(params);
	// A share of images alone has no text.
	if (!joined && !files) return null;
	const shared: Shared = { joined };
	for (const key of FIELDS) {
		const value = params.get(`shared.${key}`);
		if (value) shared[key] = value;
	}
	if (files?.skipped) shared.skipped = files.skipped;
	return shared;
}

function filesOf(params: URLSearchParams): SharedFiles | null {
	const ids = (params.get('shared.files') ?? '').split(',').filter(Boolean);
	const count = Number(params.get('shared.skipped'));
	const skipped = Number.isSafeInteger(count) && count > 0 ? count : 0;
	return ids.length || skipped ? { ids, skipped } : null;
}

/** The files a target page's fragment names, or null when it names none. */
export function filesFromFragment(hash: string): SharedFiles | null {
	const at = hash.indexOf('&url=');
	if (!hash.startsWith('#shared.') || at < 0) return null;
	return filesOf(new URLSearchParams(hash.slice(1, at)));
}

/** Whether `path` is `prefix` or under it. */
export const under = (path: string, prefix: string) =>
	prefix === '/' ? true : path === prefix || path.startsWith(`${prefix}/`);
