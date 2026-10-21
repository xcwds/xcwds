import { describe, expect, it, vi } from 'vitest';
import worker, { BODY_LIMIT, NOTION, relay, type RelayEnv } from './worker.js';

const APP = 'https://app.example';
const env: RelayEnv = { ALLOWED_ORIGINS: `${APP}, https://other.example` };
const RELAY = 'https://relay.example';
const PAGE = '59833787-2cf9-4fdf-8782-e53db20768a5';
const BLOCK = '0c940186ab704351bb342d16f0635d49';

/** A `fetch` standing in for Notion, which records what it was asked. */
function notion(response = () => Response.json({ object: 'page' })) {
	return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response());
}

function call(
	path: string,
	init: RequestInit & { origin?: string | null } = {},
	upstream = notion()
) {
	const { origin = APP, ...rest } = init;
	const headers = new Headers(rest.headers);
	if (origin) headers.set('Origin', origin);
	return relay(new Request(RELAY + path, { ...rest, headers }), env, upstream);
}

const sent = (upstream: ReturnType<typeof notion>) => {
	const [url, init] = upstream.mock.calls[0]!;
	return { url: String(url), init: init!, headers: new Headers(init!.headers) };
};

describe('the Notion relay', () => {
	it('forwards each allowed read with only the token, version and JSON type', async () => {
		const routes: [string, string][] = [
			['GET', '/v1/users/me'],
			['GET', `/v1/pages/${PAGE}`],
			['GET', `/v1/blocks/${BLOCK}`],
			['GET', `/v1/blocks/${BLOCK}/children?start_cursor=${PAGE}&page_size=100`],
			['GET', `/v1/databases/${PAGE.toUpperCase()}`],
			['GET', `/v1/data_sources/${BLOCK}`],
			['POST', `/v1/data_sources/${PAGE}/query`],
			['POST', '/v1/search']
		];
		for (const [method, path] of routes) {
			const upstream = notion();
			const response = await call(
				path,
				{
					method,
					headers: {
						Authorization: 'Bearer secret_abc',
						'Notion-Version': '2025-09-03',
						'Content-Type': 'text/plain',
						Cookie: 'session=1',
						'X-Forwarded-For': '203.0.113.9',
						'CF-Connecting-IP': '203.0.113.9'
					},
					body: method === 'POST' ? '{"page_size":10}' : undefined
				},
				upstream
			);
			expect(response.status, path).toBe(200);
			expect(await response.json()).toEqual({ object: 'page' });
			const { url, init, headers } = sent(upstream);
			expect(url).toBe(NOTION + path);
			expect(init.method).toBe(method);
			expect([...headers.keys()].sort()).toEqual(
				method === 'POST'
					? ['authorization', 'content-type', 'notion-version']
					: ['authorization', 'notion-version']
			);
			expect(headers.get('Authorization')).toBe('Bearer secret_abc');
			if (method === 'POST') {
				expect(headers.get('Content-Type')).toBe('application/json');
				expect(new TextDecoder().decode(init.body as Uint8Array)).toBe('{"page_size":10}');
			} else expect(init.body).toBeUndefined();
		}
	});

	it('refuses other methods, paths, query strings and ids before anything leaves', async () => {
		const refused: [string, string][] = [
			['DELETE', `/v1/blocks/${BLOCK}`],
			['PATCH', `/v1/pages/${PAGE}`],
			['POST', '/v1/pages'],
			['POST', `/v1/blocks/${BLOCK}/children`],
			['GET', '/v1/search'],
			['POST', '/v1/users/me'],
			['GET', '/v1/users'],
			['GET', '/v1/comments'],
			['GET', '/v1/oauth/token'],
			['GET', '/'],
			['GET', '/v1/pages/not-an-id'],
			['GET', `/v1/pages/${PAGE}x`],
			['GET', `/v1/pages/${PAGE}/`],
			['GET', `/v1/pages/${BLOCK.slice(1)}`],
			['GET', `/v1/pages/${PAGE}/properties/title`],
			['GET', `/v1/pages/%2E%2E%2Fusers`],
			['GET', `/v2/pages/${PAGE}`],
			['GET', `/v1/blocks/${BLOCK}/children?filter_properties=title`],
			['GET', `/v1/blocks/${BLOCK}/children?page_size=101`],
			['GET', `/v1/blocks/${BLOCK}/children?page_size=0`],
			['GET', `/v1/blocks/${BLOCK}/children?page_size=10&page_size=20`],
			['GET', `/v1/blocks/${BLOCK}/children?start_cursor=a%26b`]
		];
		for (const [method, path] of refused) {
			const upstream = notion();
			const response = await call(path, { method }, upstream);
			expect(response.status, `${method} ${path}`).toBe(403);
			expect(await response.json()).toMatchObject({ object: 'error', code: 'relay_forbidden' });
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe(APP);
			expect(upstream).not.toHaveBeenCalled();
		}
		// A Notion-Version that isn't one.
		const upstream = notion();
		const odd = await call('/v1/users/me', { headers: { 'Notion-Version': 'latest' } }, upstream);
		expect(odd.status).toBe(403);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('answers only allowed origins, and gives others no CORS headers', async () => {
		const ok = await call('/v1/users/me');
		expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(APP);
		expect(ok.headers.get('Vary')).toBe('Origin');
		const other = await call('/v1/users/me', { origin: 'https://other.example' });
		expect(other.headers.get('Access-Control-Allow-Origin')).toBe('https://other.example');

		for (const origin of ['https://evil.example', `${APP}.evil.example`, 'null', null]) {
			const upstream = notion();
			const response = await call('/v1/users/me', { origin }, upstream);
			expect(response.status, String(origin)).toBe(403);
			expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
			expect(upstream).not.toHaveBeenCalled();
		}
		// No origins configured: nobody.
		const upstream = notion();
		const none = await relay(
			new Request(RELAY + '/v1/users/me', { headers: { Origin: APP } }),
			{},
			upstream
		);
		expect(none.status).toBe(403);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('answers preflights for allowed requests only', async () => {
		const upstream = notion();
		const preflight = (path: string, method: string, origin = APP) =>
			call(
				path,
				{
					method: 'OPTIONS',
					origin,
					headers: { 'Access-Control-Request-Method': method }
				},
				upstream
			);
		const ok = await preflight('/v1/search', 'POST');
		expect(ok.status).toBe(204);
		expect(Object.fromEntries(ok.headers)).toMatchObject({
			'access-control-allow-origin': APP,
			'access-control-allow-methods': 'POST',
			'access-control-allow-headers': 'Authorization, Content-Type, Notion-Version'
		});
		expect((await preflight('/v1/search', 'DELETE')).status).toBe(403);
		expect((await preflight('/v1/pages', 'POST')).status).toBe(403);
		const evil = await preflight('/v1/search', 'POST', 'https://evil.example');
		expect(evil.status).toBe(403);
		expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();
		expect(upstream).not.toHaveBeenCalled();
	});

	it('refuses bodies over 64 KB, declared or not', async () => {
		const big = 'x'.repeat(BODY_LIMIT + 1);
		const upstream = notion();
		const declared = await call('/v1/search', { method: 'POST', body: big }, upstream);
		expect(declared.status).toBe(413);
		const streamed = await relay(
			new Request(RELAY + '/v1/search', {
				method: 'POST',
				headers: { Origin: APP },
				body: new ReadableStream({
					start(controller) {
						for (let i = 0; i < 5; i++) controller.enqueue(new Uint8Array(BODY_LIMIT / 4));
						controller.close();
					}
				}),
				duplex: 'half'
			} as RequestInit),
			env,
			upstream
		);
		expect(streamed.status).toBe(413);
		expect(streamed.headers.get('Access-Control-Allow-Origin')).toBe(APP);
		expect(upstream).not.toHaveBeenCalled();

		const exact = await call('/v1/search', { method: 'POST', body: 'x'.repeat(BODY_LIMIT) });
		expect(exact.status).toBe(200);
	});

	it("passes Notion's answer through with no-store, keeping only its type and Retry-After", async () => {
		const limited = await call(
			'/v1/users/me',
			{},
			notion(
				() =>
					new Response('{"object":"error","status":429}', {
						status: 429,
						headers: {
							'Content-Type': 'application/json',
							'Retry-After': '7',
							'Set-Cookie': 'notion=1',
							'X-Notion-Request-Id': 'abc'
						}
					})
			)
		);
		expect(limited.status).toBe(429);
		expect(await limited.text()).toBe('{"object":"error","status":429}');
		expect(Object.fromEntries(limited.headers)).toEqual({
			'access-control-allow-origin': APP,
			'access-control-expose-headers': 'Retry-After',
			'cache-control': 'no-store',
			'content-type': 'application/json',
			'retry-after': '7',
			vary: 'Origin'
		});

		const down = await call(
			'/v1/users/me',
			{},
			vi.fn(async () => {
				throw new TypeError('network');
			})
		);
		expect(down.status).toBe(502);
		expect(down.headers.get('Access-Control-Allow-Origin')).toBe(APP);
	});

	it('is a Worker module that uses the runtime fetch', async () => {
		const upstream = vi.fn(async () => Response.json({ object: 'user' }));
		vi.stubGlobal('fetch', upstream);
		try {
			const response = await worker.fetch(
				new Request(RELAY + '/v1/users/me', { headers: { Origin: APP } }),
				env
			);
			expect(response.status).toBe(200);
			expect(upstream).toHaveBeenCalledOnce();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
