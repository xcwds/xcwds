/**
 * The Notion API client for `@xcwds/plugin-notion` (#106), through the relay (`relay/`): pins
 * `Notion-Version`, follows `start_cursor` pagination, keeps requests apart to stay under
 * Notion's ~3 requests a second, waits out `429` (`Retry-After`, then backoff), and stops when its
 * `signal` aborts. `blocks` fetches a page's content recursively, up to a depth and a number of
 * blocks, and says when it stopped short instead of failing.
 *
 * Failures are `NotionError`s with a `kind` a page can explain. Their messages never carry the
 * token or what Notion said, so they're safe to show. Browser globals (`fetch`, timers) are only
 * reached when a request runs.
 */

/** The API version requests pin (the data sources API). */
export const NOTION_VERSION = '2025-09-03';
/** The least time between two requests' starts, in ms: Notion allows about 3 a second. */
export const INTERVAL = 350;
/** How deep `blocks` goes below the page, and how many blocks it fetches at most. */
export const MAX_DEPTH = 5;
export const MAX_BLOCKS = 2000;
/** How often a rate-limited request is tried again, and the longest wait it takes. */
const RETRIES = 3;
const MAX_WAIT = 60_000;

/** Why a request failed. */
export type NotionErrorKind =
	/** No connection (or the relay couldn't reach Notion). */
	| 'offline'
	/** Notion refused the token. */
	| 'unauthorized'
	/** The page or database isn't shared with the integration (or doesn't exist). */
	| 'not-shared'
	/** Still rate limited after waiting. */
	| 'rate-limited'
	/** The request was cancelled (`signal`). */
	| 'aborted'
	/** Anything else: the relay refused it, or Notion failed. */
	| 'failed';

const MESSAGES: Record<NotionErrorKind, string> = {
	offline: "Couldn't reach Notion. Check the connection.",
	unauthorized: 'Notion refused the token. Connect again with a valid token.',
	'not-shared': "This page isn't shared with the integration in Notion (••• → Connections).",
	'rate-limited': 'Notion is busy. Try again in a minute.',
	aborted: 'The download was cancelled.',
	failed: "Notion couldn't send this. Try again later."
};

/** A failed request. `message` is safe to show: it never includes the token or Notion's text. */
export class NotionError extends Error {
	readonly kind: NotionErrorKind;
	/** The HTTP status, when there was a response. */
	readonly status: number | undefined;
	/** Notion's (or the relay's) error code, when it sent one: `object_not_found`. */
	readonly code: string | undefined;
	constructor(kind: NotionErrorKind, status?: number, code?: string) {
		super(MESSAGES[kind]);
		this.name = 'NotionError';
		this.kind = kind;
		this.status = status;
		this.code = code;
	}
}

/** A Notion block as the API sends it, with its children once `blocks` fetched them. */
export type RawBlock = {
	id: string;
	type: string;
	has_children?: boolean;
	children?: RawBlock[];
	[key: string]: unknown;
};

/** A Notion page (or other object) as the API sends it. */
export type RawObject = { id: string; object: string; [key: string]: unknown };

/** One page of a paginated list. */
export type List<T> = { results: T[]; has_more: boolean; next_cursor: string | null };

export type NotionClientOptions = {
	/** The relay's origin: `https://notion-relay.example.com`. */
	relay: string;
	/** The integration token, sent as `Authorization: Bearer`. */
	token: string;
	/** Cancels every request and wait (on page hide, say). */
	signal?: AbortSignal;
	/** For tests: the `fetch`, timer and clock to use, and the gap between requests. */
	fetch?: typeof fetch;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	now?: () => number;
	interval?: number;
};

const ID =
	/(?<![0-9a-f])([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})(?![0-9a-f])/i;

/**
 * The Notion id in a page or database link (`https://www.notion.so/Agenda-0c94…5d49?v=…`) or
 * given on its own, dashed, or `undefined` when there's none. A link's last id before the query
 * is the page's (a `?v=` view id or `#` block id doesn't count).
 */
export function parseId(input: string): string | undefined {
	let text = input.trim();
	if (/^https?:\/\//i.test(text)) {
		if (!URL.canParse(text)) return undefined;
		text = new URL(text).pathname;
	}
	const all = [...text.matchAll(new RegExp(ID.source, 'gi'))];
	const last = all.at(-1);
	if (!last) return undefined;
	return last.slice(1, 6).join('-').toLowerCase();
}

/** Waits `ms`, or rejects with an `AbortError` when `signal` aborts. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const timer = setTimeout(done, ms);
		function done() {
			signal?.removeEventListener('abort', abort);
			resolve();
		}
		function abort() {
			clearTimeout(timer);
			reject(signal!.reason);
		}
		signal?.addEventListener('abort', abort, { once: true });
	});
}

/** `Retry-After` in ms (seconds or an HTTP date), or `undefined`. */
function retryAfter(value: string | null, now: number): number | undefined {
	if (!value) return undefined;
	if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
	const at = Date.parse(value);
	return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function kindOf(status: number): NotionErrorKind {
	if (status === 401) return 'unauthorized';
	if (status === 404) return 'not-shared';
	return 'failed';
}

export type NotionClient = ReturnType<typeof createNotionClient>;

/** A client for the Notion API through `relay`, with `token`. */
export function createNotionClient(options: NotionClientOptions) {
	const relay = options.relay.replace(/\/+$/, '');
	const sleep = options.sleep ?? wait;
	const now = options.now ?? (() => Date.now());
	const interval = options.interval ?? INTERVAL;
	const signal = options.signal;
	/** When the next request may start; requests take turns. */
	let next = 0;
	let queue: Promise<unknown> = Promise.resolve();

	const aborted = () => new NotionError('aborted');

	/** Waits for this request's turn, keeping `interval` between starts. */
	function turn<T>(run: () => Promise<T>): Promise<T> {
		const result = queue.then(async () => {
			const delay = next - now();
			if (delay > 0) await sleep(delay, signal);
			next = now() + interval;
			return run();
		});
		queue = result.catch(() => {});
		return result;
	}

	async function send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
		const fetcher = options.fetch ?? globalThis.fetch;
		if (signal?.aborted) throw aborted();
		try {
			return await fetcher(relay + path, {
				method,
				headers: {
					Authorization: `Bearer ${options.token}`,
					'Notion-Version': NOTION_VERSION,
					...(body === undefined ? {} : { 'Content-Type': 'application/json' })
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal,
				credentials: 'omit',
				cache: 'no-store',
				referrerPolicy: 'no-referrer'
			});
		} catch {
			throw signal?.aborted ? aborted() : new NotionError('offline');
		}
	}

	/** One request, in turn, tried again while rate limited. */
	async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
		for (let attempt = 0; ; attempt++) {
			if (signal?.aborted) throw aborted();
			let response: Response;
			try {
				response = await turn(() => send(method, path, body));
			} catch (error) {
				// Aborted while waiting for its turn.
				if (error instanceof NotionError) throw error;
				throw aborted();
			}
			if (response.ok) {
				try {
					return (await response.json()) as T;
				} catch {
					throw signal?.aborted ? aborted() : new NotionError('failed', response.status);
				}
			}
			const code = await response
				.json()
				.then((error: { code?: unknown }) =>
					typeof error?.code === 'string' ? error.code : undefined
				)
				.catch(() => undefined);
			if (response.status === 429) {
				const ms = retryAfter(response.headers.get('Retry-After'), now()) ?? 1000 * 2 ** attempt;
				if (attempt >= RETRIES || ms > MAX_WAIT) throw new NotionError('rate-limited', 429, code);
				try {
					await sleep(ms, signal);
				} catch {
					throw aborted();
				}
				continue;
			}
			// The relay answers 502 when Notion can't be reached.
			if (response.status === 502 && code === 'relay_upstream') {
				throw new NotionError('offline', 502, code);
			}
			const kind =
				response.status === 403 && code === 'restricted_resource'
					? 'not-shared'
					: kindOf(response.status);
			throw new NotionError(kind, response.status, code);
		}
	}

	/** Every page of a paginated list, `next(cursor)` fetching one. */
	async function all<T>(next: (cursor?: string) => Promise<List<T>>): Promise<T[]> {
		const results: T[] = [];
		let cursor: string | undefined;
		for (;;) {
			const page = await next(cursor);
			results.push(...page.results);
			if (!page.has_more || !page.next_cursor) return results;
			cursor = page.next_cursor;
		}
	}

	const path = (id: string) => encodeURIComponent(id);
	const children = (id: string, cursor?: string) =>
		request<List<RawBlock>>(
			'GET',
			`/v1/blocks/${path(id)}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`
		);

	return {
		/** The integration's bot user (checks the token). */
		me: () => request<RawObject & { name?: string | null }>('GET', '/v1/users/me'),
		page: (id: string) => request<RawObject>('GET', `/v1/pages/${path(id)}`),
		database: (id: string) => request<RawObject>('GET', `/v1/databases/${path(id)}`),
		dataSource: (id: string) => request<RawObject>('GET', `/v1/data_sources/${path(id)}`),
		/** One page of a data source's query (`sorts`, `filter`, `page_size`). */
		query: (id: string, body: Record<string, unknown> = {}) =>
			request<List<RawObject>>('POST', `/v1/data_sources/${path(id)}/query`, body),
		/** One page of search results. */
		search: (body: Record<string, unknown> = {}) =>
			request<List<RawObject>>('POST', '/v1/search', body),
		/** One page of a block's children. */
		children,
		/** All of a block's direct children. */
		allChildren: (id: string) => all((cursor) => children(id, cursor)),
		/**
		 * The blocks of a page with their children, depth first in Notion's order, at most
		 * `maxDepth` levels and `maxBlocks` blocks; `truncated` when it stopped short. Child pages and
		 * databases are pages of their own, so their content isn't fetched.
		 */
		async blocks(
			id: string,
			{ maxDepth = MAX_DEPTH, maxBlocks = MAX_BLOCKS } = {}
		): Promise<{ blocks: RawBlock[]; truncated: boolean }> {
			let count = 0;
			let truncated = false;
			async function level(parent: string, depth: number): Promise<RawBlock[]> {
				const blocks: RawBlock[] = [];
				let cursor: string | undefined;
				for (;;) {
					const page = await children(parent, cursor);
					for (const block of page.results) {
						if (count >= maxBlocks) {
							truncated = true;
							return blocks;
						}
						count++;
						blocks.push(block);
					}
					if (!page.has_more || !page.next_cursor) break;
					if (count >= maxBlocks) {
						truncated = true;
						return blocks;
					}
					cursor = page.next_cursor;
				}
				for (const block of blocks) {
					if (!block.has_children || block.type === 'child_page' || block.type === 'child_database')
						continue;
					if (depth >= maxDepth || count >= maxBlocks) {
						truncated = true;
						continue;
					}
					block.children = await level(block.id, depth + 1);
				}
				return blocks;
			}
			const blocks = await level(id, 1);
			return { blocks, truncated };
		}
	};
}
