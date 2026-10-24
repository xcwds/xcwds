/**
 * A stateless, read-only relay to the Notion API for `@xcwds/plugin-notion` (#105), deployed as a
 * Cloudflare Worker (see `README.md`). The Notion API sends no CORS headers, so a static app can't
 * call it from the browser; this adds them for the app's own origins and forwards a short
 * allowlist of read requests, and nothing else.
 *
 * - It holds no token: the app sends the person's own `Authorization: Bearer <token>`, passed on
 *   unchanged. Without one, Notion refuses the request.
 * - It stores nothing (no KV, cache or logs) and answers with `Cache-Control: no-store`.
 * - Only the routes in `ROUTES`, with Notion ids, and only `start_cursor` and `page_size` in the
 *   query string. Anything else is refused with `403` before a request leaves.
 * - Only requests from an origin in `ALLOWED_ORIGINS` (a browser always sends `Origin` to another
 *   origin); others are refused, with no CORS headers. That stops other sites using the relay
 *   from a browser. It isn't authentication: the token is.
 * - Only `Authorization`, `Notion-Version` and `Content-Type` (always JSON) are forwarded, with a
 *   body of at most 64 KB (`BODY_LIMIT`); no cookies or client address headers. Only `Content-Type` and
 *   `Retry-After` come back from Notion's headers.
 * - `GET /file?url=…` (#108) fetches an image Notion hosts, from the signed link Notion gave the
 *   app, so the app never contacts the file's origin itself. Only `https:` links on the hosts in
 *   `FILE_HOSTS`, sent with no headers at all (the token stays behind), and only images
 *   (`FILE_TYPES`) of at most `FILE_LIMIT` bytes come back.
 *
 * No dependencies beyond the Workers runtime (standard `fetch`, `Request` and `Response`).
 */

/** The Worker's variables (`[vars]` in `wrangler.toml`). */
export type RelayEnv = {
	/** The origins allowed to use the relay, separated by commas or spaces: `https://xcwds.com`. */
	ALLOWED_ORIGINS?: string;
};

/** Where requests go. */
export const NOTION = 'https://api.notion.com';

/** The largest request body forwarded, in bytes. */
export const BODY_LIMIT = 64 * 1024;

/** The largest file `/file` passes on, in bytes. */
export const FILE_LIMIT = 5 * 1024 * 1024;

/**
 * Where the files Notion hosts live: its S3 bucket, and `notion-static.com` with any subdomain.
 * Nothing else, so the relay can't be used to fetch the wider web.
 */
export function fileHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return (
		host === 'prod-files-secure.s3.us-west-2.amazonaws.com' || host.endsWith('.notion-static.com')
	);
}

/** The image types `/file` passes on. */
export const FILE_TYPES: ReadonlySet<string> = new Set([
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'image/avif',
	'image/svg+xml'
]);

/** The longest file link accepted (Notion's signed S3 links run to about 1,500 characters). */
const FILE_URL_LIMIT = 4096;

/** A Notion id: a UUID, dashed or not. */
const ID = '(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

/** The requests the relay forwards: read-only at launch (writes come with #109). */
export const ROUTES: readonly { method: 'GET' | 'POST'; path: RegExp }[] = [
	{ method: 'GET', path: /^\/v1\/users\/me$/ },
	{ method: 'GET', path: new RegExp(`^/v1/pages/${ID}$`, 'i') },
	{ method: 'GET', path: new RegExp(`^/v1/blocks/${ID}$`, 'i') },
	{ method: 'GET', path: new RegExp(`^/v1/blocks/${ID}/children$`, 'i') },
	{ method: 'GET', path: new RegExp(`^/v1/databases/${ID}$`, 'i') },
	{ method: 'GET', path: new RegExp(`^/v1/data_sources/${ID}$`, 'i') },
	{ method: 'POST', path: new RegExp(`^/v1/data_sources/${ID}/query$`, 'i') },
	{ method: 'POST', path: /^\/v1\/search$/ }
];

/** The query parameters allowed, and what their values must look like. */
const QUERY: Record<string, RegExp> = {
	start_cursor: /^[0-9a-z-]{1,64}$/i,
	page_size: /^(?:[1-9]\d?|100)$/
};

const ALLOW_HEADERS = 'Authorization, Content-Type, Notion-Version';
/** `Notion-Version` is a date. */
const VERSION = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The allowed origins in `env`, as browsers write them in `Origin` (so `https://Example.com/`
 * matches `https://example.com`). Entries that aren't URLs are left out.
 */
function origins(env: RelayEnv): Set<string> {
	const allowed = new Set<string>();
	for (const entry of (env.ALLOWED_ORIGINS ?? '').split(/[\s,]+/)) {
		if (!URL.canParse(entry)) continue;
		const { origin } = new URL(entry);
		if (origin !== 'null') allowed.add(origin);
	}
	return allowed;
}

/** The route `method` and `path` match, if any. */
function route(method: string, path: string) {
	return ROUTES.find((r) => r.method === method && r.path.test(path));
}

/** Whether the query string has only allowed parameters, each once and well-formed. */
function queryAllowed(params: URLSearchParams): boolean {
	const seen = new Set<string>();
	for (const [name, value] of params) {
		const pattern = QUERY[name];
		if (!pattern || seen.has(name) || !pattern.test(value)) return false;
		seen.add(name);
	}
	return true;
}

/** The CORS headers for an allowed origin. */
function cors(origin: string): Record<string, string> {
	return {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Expose-Headers': 'Retry-After',
		Vary: 'Origin'
	};
}

/** An error the relay answers itself, shaped like Notion's errors. */
function refuse(
	status: number,
	message: string,
	headers: Record<string, string> = {},
	code = status === 413
		? 'relay_body_too_large'
		: status === 502
			? 'relay_upstream'
			: 'relay_forbidden'
) {
	return new Response(JSON.stringify({ object: 'error', status, code, message }), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			Vary: 'Origin',
			...headers
		}
	});
}

/** The request's body, or `null` if it's longer than `BODY_LIMIT`. */
async function readBody(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
	const declared = Number(request.headers.get('Content-Length'));
	if (declared > BODY_LIMIT) return null;
	const parts: Uint8Array[] = [];
	let size = 0;
	if (request.body) {
		const reader = request.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > BODY_LIMIT) {
				await reader.cancel().catch(() => {});
				return null;
			}
			parts.push(value);
		}
	}
	const body = new Uint8Array(size);
	let at = 0;
	for (const part of parts) {
		body.set(part, at);
		at += part.byteLength;
	}
	return body;
}

/**
 * `GET /file?url=<link>`: one image Notion hosts, fetched from its signed link with no headers
 * (no token, no cookies), and passed on only if it's an image within `FILE_LIMIT`.
 */
async function file(
	url: URL,
	allowed: Record<string, string>,
	upstream: typeof fetch
): Promise<Response> {
	const params = [...url.searchParams];
	const link = params.length === 1 && params[0]![0] === 'url' ? params[0]![1] : '';
	const target = link.length <= FILE_URL_LIMIT && URL.canParse(link) ? new URL(link) : undefined;
	if (
		!target ||
		target.protocol !== 'https:' ||
		target.port !== '' ||
		target.username !== '' ||
		target.password !== '' ||
		!fileHost(target.hostname)
	) {
		return refuse(403, 'Not a file Notion hosts.', allowed);
	}

	let response: Response;
	try {
		response = await upstream(target.href, { method: 'GET', redirect: 'manual' });
	} catch {
		return refuse(502, "The file couldn't be reached.", allowed);
	}
	const drop = () => response.body?.cancel().catch(() => {});
	// An expired or wrong link (S3 answers 403), or a redirect elsewhere.
	if (response.status !== 200) {
		void drop();
		return refuse(502, "The file couldn't be fetched.", allowed, 'relay_file');
	}
	const type = (response.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
	if (!FILE_TYPES.has(type)) {
		void drop();
		return refuse(415, 'Only images are passed on.', allowed, 'relay_file_type');
	}
	const declared = response.headers.get('Content-Length');
	if (Number(declared) > FILE_LIMIT) {
		void drop();
		return refuse(
			413,
			`Files are limited to ${FILE_LIMIT} bytes.`,
			allowed,
			'relay_file_too_large'
		);
	}
	// A file without a length, or longer than it said, is cut off with an error past the limit.
	let size = 0;
	const body = response.body?.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				size += chunk.byteLength;
				if (size > FILE_LIMIT) controller.error(new Error('File too large'));
				else controller.enqueue(chunk);
			}
		})
	);
	const out = new Headers({
		...allowed,
		'Cache-Control': 'no-store',
		'Content-Type': type,
		// Opened in a tab, it's an image on the relay's origin and nothing else.
		'Content-Security-Policy': "default-src 'none'; sandbox",
		'X-Content-Type-Options': 'nosniff'
	});
	if (declared && /^\d+$/.test(declared)) out.set('Content-Length', declared);
	return new Response(body ?? null, { status: 200, headers: out });
}

/**
 * Answers one request. `upstream` is the `fetch` that reaches Notion; tests pass their own.
 */
export async function relay(
	request: Request,
	env: RelayEnv,
	upstream: typeof fetch = fetch
): Promise<Response> {
	const origin = request.headers.get('Origin');
	if (!origin || !origins(env).has(origin)) {
		return refuse(403, 'This origin may not use the relay.');
	}
	const allowed = cors(origin);
	const url = new URL(request.url);

	if (request.method === 'OPTIONS') {
		const method = request.headers.get('Access-Control-Request-Method') ?? '';
		if (!route(method, url.pathname))
			return refuse(403, 'Not a request the relay forwards.', allowed);
		return new Response(null, {
			status: 204,
			headers: {
				...allowed,
				'Access-Control-Allow-Methods': method,
				'Access-Control-Allow-Headers': ALLOW_HEADERS,
				'Access-Control-Max-Age': '86400',
				'Cache-Control': 'no-store'
			}
		});
	}

	if (request.method === 'GET' && url.pathname === '/file') return file(url, allowed, upstream);

	if (!route(request.method, url.pathname) || !queryAllowed(url.searchParams)) {
		return refuse(403, 'Not a request the relay forwards.', allowed);
	}

	const headers = new Headers();
	const authorization = request.headers.get('Authorization');
	if (authorization) headers.set('Authorization', authorization);
	const version = request.headers.get('Notion-Version');
	if (version) {
		if (!VERSION.test(version)) return refuse(403, 'Not a Notion-Version.', allowed);
		headers.set('Notion-Version', version);
	}

	let body: Uint8Array<ArrayBuffer> | undefined;
	if (request.method === 'POST') {
		const read = await readBody(request);
		if (!read) return refuse(413, `Request bodies are limited to ${BODY_LIMIT} bytes.`, allowed);
		body = read;
		// Notion takes only JSON.
		headers.set('Content-Type', 'application/json');
	}

	let response: Response;
	try {
		// Exactly the parameters checked above.
		const query = url.searchParams.toString();
		response = await upstream(NOTION + url.pathname + (query ? `?${query}` : ''), {
			method: request.method,
			headers,
			body,
			redirect: 'manual'
		});
	} catch {
		return refuse(502, "Notion couldn't be reached.", allowed);
	}

	const out = new Headers({ ...allowed, 'Cache-Control': 'no-store' });
	for (const name of ['Content-Type', 'Retry-After']) {
		const value = response.headers.get(name);
		if (value) out.set(name, value);
	}
	return new Response(response.body, { status: response.status, headers: out });
}

export default {
	fetch: (request: Request, env: RelayEnv) => relay(request, env)
};
