import { describe, expect, it } from 'vitest';
import { createApp, definePlugin } from './app.js';
import { codes, XcwdsError } from './errors.js';
import { checkNetwork, isOrigin, resolveNetwork, savedDataInQuery } from './privacy.js';
import { memoryStorage } from './storage.js';

describe('isOrigin', () => {
	it('takes https and wss origins exactly as URL writes them', () => {
		expect(isOrigin('https://example.com')).toBe(true);
		expect(isOrigin('https://api.example.com:8443')).toBe(true);
		expect(isOrigin('wss://live.example.com')).toBe(true);
		for (const bad of [
			'http://example.com',
			'https://example.com/',
			'https://example.com/path',
			'https://EXAMPLE.com',
			'example.com',
			'*',
			'',
			3
		])
			expect(isOrigin(bad)).toBe(false);
	});
});

describe('checkNetwork', () => {
	it('defaults to false and dedupes origins', () => {
		expect(checkNetwork(undefined, 'p')).toBe(false);
		expect(checkNetwork(false, 'p')).toBe(false);
		expect(
			checkNetwork({ origins: ['https://a.example', 'https://a.example'], reason: 'Weather' }, 'p')
		).toEqual({ origins: ['https://a.example'], reason: 'Weather' });
	});

	it.each([
		[true, 'use false or { origins, reason }'],
		[{ origins: [], reason: 'x' }, 'non-empty array'],
		[{ origins: ['http://a.example'], reason: 'x' }, '"http://a.example" isn\'t an https'],
		[{ origins: ['https://a.example'] }, '`reason` must say why'],
		[{ origins: ['https://a.example'], reason: ' ' }, '`reason` must say why']
	])('rejects %j', (value, message) => {
		let error: unknown;
		try {
			checkNetwork(value, 'my-plugin');
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(XcwdsError);
		expect((error as XcwdsError).code).toBe(codes.PLUGIN_META);
		expect((error as XcwdsError).plugin).toBe('my-plugin');
		expect((error as Error).message).toContain('my-plugin');
		expect((error as Error).message).toContain(message);
	});

	it('fails a plugin with bad metadata when it loads', async () => {
		const app = createApp({ storage: memoryStorage(), logLevel: 'silent' });
		app.register(
			definePlugin(() => {}, {
				name: 'leaky',
				network: { origins: ['https://example.com/x'], reason: 'oops' }
			})
		);
		await expect(app.ready()).rejects.toMatchObject({ code: codes.PLUGIN_META, plugin: 'leaky' });
	});
});

describe('resolveNetwork', () => {
	const relay = (options: { relay?: string }) =>
		options.relay ? { origins: [options.relay], reason: 'Syncs pages' } : false;

	it('resolves a function with the options', () => {
		expect(resolveNetwork(relay, { relay: 'https://relay.example' }, 'p')).toEqual({
			origins: ['https://relay.example'],
			reason: 'Syncs pages'
		});
		expect(resolveNetwork(relay, {}, 'p')).toBe(false);
		expect(resolveNetwork(() => undefined, {}, 'p')).toBe(false);
	});

	it('treats static declarations as checkNetwork does', () => {
		expect(resolveNetwork(undefined, {}, 'p')).toBe(false);
		const use = { origins: ['https://a.example'], reason: 'r' };
		expect(resolveNetwork(use, { relay: 'https://b.example' }, 'p')).toEqual(use);
		expect(() => checkNetwork(relay, 'p')).toThrow('use resolveNetwork');
	});

	it.each([
		[() => ({ origins: ['http://relay.example'], reason: 'r' }), "isn't an https or wss origin"],
		[() => 'https://relay.example', 'use false or { origins, reason }'],
		[
			async () => ({ origins: ['https://relay.example'], reason: 'r' }),
			'must return synchronously'
		],
		[
			() => {
				throw new Error('`relay` is required');
			},
			'its function threw: `relay` is required'
		]
	])('fails %s with the plugin name', (value, message) => {
		let error: unknown;
		try {
			resolveNetwork(value, {}, 'my-plugin');
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(XcwdsError);
		expect((error as XcwdsError).code).toBe(codes.PLUGIN_META);
		expect((error as XcwdsError).plugin).toBe('my-plugin');
		expect((error as Error).message).toContain('Plugin "my-plugin" has invalid `network`');
		expect((error as Error).message).toContain(message);
	});

	it('resolves on load with the registered options, without prefix', async () => {
		const seen: Record<string, unknown>[] = [];
		const plugin = definePlugin<{ relay?: string }>(() => {}, {
			name: 'notion',
			network: (options) => (seen.push(options), relay(options))
		});
		const app = createApp({ storage: memoryStorage(), logLevel: 'silent' });
		app.register(plugin, { relay: 'https://relay.example', prefix: '/notion' } as never);
		await app.ready();
		expect(seen).toEqual([{ relay: 'https://relay.example' }]);

		const bad = createApp({ storage: memoryStorage(), logLevel: 'silent' });
		bad.register(plugin, { relay: 'http://relay.example' });
		await expect(bad.ready()).rejects.toMatchObject({ code: codes.PLUGIN_META, plugin: 'notion' });
	});
});

describe('savedDataInQuery', () => {
	const url = (s: string) => new URL(s, 'https://app.example');
	it('names query parameters that carry saved strings, however deep', () => {
		const saved = [{ notes: ['my secret diary'] }, 'abc', 42, null];
		expect(savedDataInQuery(url('/a?q=my%20secret%20diary&b=1'), saved)).toEqual(['q']);
		expect(savedDataInQuery(url('/a?q=xx-my secret diary-xx'), saved)).toEqual(['q']);
	});
	it('ignores short values, fragments and pages without a query', () => {
		expect(savedDataInQuery(url('/a?q=abc'), ['abc'])).toEqual([]);
		expect(savedDataInQuery(url('/a#q=my secret diary'), ['my secret diary'])).toEqual([]);
		expect(savedDataInQuery(url('/a?q=other'), ['my secret diary'])).toEqual([]);
	});
});
