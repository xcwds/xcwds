import { describe, expect, it, vi } from 'vitest';
import { allows, guardFetch, guardNetwork, type GuardScope } from './guard.js';

const SELF = 'https://app.example';
const ALLOWED = ['https://api.example', 'http://localhost:8080'];

describe('allows', () => {
	it('lets through the app’s own origin, local URLs and the allowed origins', () => {
		for (const url of [
			'/data.json',
			'https://app.example/x',
			'wss://app.example/socket',
			'data:text/plain,hi',
			'blob:https://app.example/1',
			'https://api.example/v1?q=1',
			'wss://api.example/live',
			'http://localhost:8080/',
			new URL('https://api.example/u'),
			new Request('https://api.example/r')
		])
			expect(allows(url, SELF, ALLOWED), String(url)).toBe(true);
	});

	it('refuses every other origin, including look-alikes', () => {
		for (const url of [
			'https://evil.example/',
			'//evil.example/x',
			'http://api.example/',
			'https://api.example:444/',
			'https://api.example.evil.example/',
			'http://localhost:8081/',
			new Request('https://evil.example/r')
		])
			expect(allows(url, SELF, ALLOWED), String(url)).toBe(false);
	});
});

describe('guardFetch', () => {
	it('passes allowed requests on and rejects others, naming the origin', async () => {
		const inner = vi.fn<typeof globalThis.fetch>(async () => new Response('ok'));
		const guarded = guardFetch(inner, SELF, ALLOWED);
		expect(await (await guarded('https://api.example/x')).text()).toBe('ok');
		await expect(guarded('https://evil.example/steal?d=1')).rejects.toThrow(
			/blocked a request to https:\/\/evil\.example from the service worker/
		);
		expect(inner).toHaveBeenCalledTimes(1);
	});
});

describe('guardNetwork', () => {
	function scope() {
		const opened: unknown[] = [];
		class Socket {
			constructor(url: string | URL) {
				opened.push(String(url));
			}
		}
		const added: unknown[] = [];
		class FakeCache {
			async add(request: RequestInfo | URL) {
				added.push(String(request));
			}
			async addAll(requests: (RequestInfo | URL)[]) {
				added.push(...requests.map(String));
			}
		}
		const s: GuardScope = {
			location: { origin: SELF },
			fetch: vi.fn(async () => new Response('net')) as unknown as typeof fetch,
			WebSocket: Socket,
			EventSource: Socket,
			Cache: FakeCache
		};
		return { s, opened, added, FakeCache };
	}

	it('guards fetch, WebSocket, EventSource and Cache#add/addAll', async () => {
		const { s, opened, added, FakeCache } = scope();
		guardNetwork(s, ALLOWED);
		await expect(s.fetch!('/ok')).resolves.toBeInstanceOf(Response);
		await expect(s.fetch!('https://evil.example')).rejects.toThrow(TypeError);

		new s.WebSocket!('wss://api.example/live');
		expect(() => new s.WebSocket!('wss://evil.example')).toThrow(/evil\.example/);
		expect(() => new s.EventSource!('https://evil.example/events')).toThrow(/evil\.example/);
		expect(opened).toEqual(['wss://api.example/live']);
		expect(s.WebSocket!.name).toBe('WebSocket');

		const cache = new FakeCache();
		await cache.addAll(['/a', 'https://api.example/b']);
		await expect(cache.add('https://evil.example/c')).rejects.toThrow(/evil\.example/);
		await expect(cache.addAll(['/d', 'https://evil.example/e'])).rejects.toThrow();
		expect(added).toEqual(['/a', 'https://api.example/b']);
	});

	it('leaves APIs the scope doesn’t have alone', () => {
		const s: GuardScope = { location: { origin: SELF } };
		guardNetwork(s, []);
		expect(s).toEqual({ location: { origin: SELF } });
	});
});
