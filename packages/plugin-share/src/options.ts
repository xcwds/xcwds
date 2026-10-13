/** The plugin's options, checked the same way in the build, the page and the worker. */
import { XcwdsError, codes } from '@xcwds/core';

export const NAME = '@xcwds/plugin-share';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.2.0';

export type ShareOptions = {
	/**
	 * The page that receives shares from other apps (Android's share sheet, via the manifest's
	 * `share_target`), e.g. `/utils/url-sanitizer`. Without it the app is no share target.
	 */
	target?: string;
	/** Paths (and everything under them) whose page never shows the Share button. */
	exclude?: string[];
};

export type ResolvedShareOptions = { target: string | null; exclude: string[] };

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
	const unknown = Object.keys(options).filter((k) => !['target', 'exclude', 'prefix'].includes(k));
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const target = options.target ?? null;
	if (target !== null && (!isPath(target) || target === '/'))
		fail('`target` must be an app path other than "/" (no trailing slash, query or hash).');
	const exclude = options.exclude ?? ['/settings'];
	if (!Array.isArray(exclude) || !exclude.every(isPath))
		fail('`exclude` must be a list of app paths starting with "/".');
	return { target, exclude: [...exclude] };
}

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
};

/** The shared fields from a query string (`?url=…&text=…&title=…`), or null if none. */
export function fromQuery(params: URLSearchParams): Shared | null {
	const fields: Partial<Record<(typeof FIELDS)[number], string>> = {};
	for (const key of FIELDS) {
		const value = params.get(key)?.trim();
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
 * The fragment a share moves to: each field as `shared.<name>=`, then `url=<joined>` last. The
 * iPhone Shortcut opens `#url=<link>` directly, and may not encode `&` or `+` in the link, so
 * everything after `url=` is the link, decoded whole (never split or read as form data).
 */
export function toFragment(shared: Shared): string {
	const params = new URLSearchParams();
	for (const key of FIELDS) {
		const value = shared[key];
		if (value) params.set(`shared.${key}`, value);
	}
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
	if (!joined) return null;
	const shared: Shared = { joined };
	const params = new URLSearchParams(prefix);
	for (const key of FIELDS) {
		const value = params.get(`shared.${key}`);
		if (value) shared[key] = value;
	}
	return shared;
}

/** Whether `path` is `prefix` or under it. */
export const under = (path: string, prefix: string) =>
	prefix === '/' ? true : path === prefix || path.startsWith(`${prefix}/`);
