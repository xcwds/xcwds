import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createApp, definePlugin, defaultNamespace, type App } from './app.js';
import { codes, XcwdsError } from './errors.js';
import { memoryStorage } from './storage.js';

declare module './app.js' {
	interface App {
		toast?: (message: string) => void;
	}
}

const testApp = (options: Parameters<typeof createApp>[0] = {}) =>
	createApp({ storage: memoryStorage(), logLevel: 'silent', ...options });

async function rejects(promise: Promise<unknown>, code: string) {
	const error = await promise.then(
		() => undefined,
		(e: unknown) => e
	);
	expect(error).toBeInstanceOf(XcwdsError);
	expect((error as XcwdsError).code).toBe(code);
	return error as XcwdsError;
}

describe('plugin loading', () => {
	it('loads plugins in order, children before the next sibling (avvio order)', async () => {
		const order: string[] = [];
		const app = testApp();
		app.register(
			definePlugin(async (a) => {
				order.push('a');
				a.register(async () => {
					await new Promise((r) => setTimeout(r, 5));
					order.push('a.child');
				});
			})
		);
		app.register(async () => void order.push('b'));
		await app.ready();
		expect(order).toEqual(['a', 'a.child', 'b']);
	});

	it('passes options without the prefix, and joins prefixes', async () => {
		const seen: unknown[] = [];
		const app = testApp();
		app.register(
			definePlugin(
				(a, opts) => {
					seen.push(opts, a.prefix);
					a.register(
						definePlugin((b) => void seen.push(b.prefix), { name: 'inner' }),
						{ prefix: 'timer/' }
					);
				},
				{ name: 'outer' }
			),
			{ prefix: '/utils', minutes: 5 } as never
		);
		await app.ready();
		expect(seen).toEqual([{ minutes: 5 }, '/utils', '/utils/timer']);
	});

	it('runs onReady once, after every plugin loads', async () => {
		const ready = vi.fn();
		const app = testApp();
		app.register((a) => void a.addHook('onReady', ready));
		await Promise.all([app.ready(), app.ready()]);
		await app.ready();
		expect(ready).toHaveBeenCalledTimes(1);
	});

	it('refuses registrations after loading', async () => {
		const app = testApp();
		await app.load();
		expect(() => app.register(() => {})).toThrowError(
			expect.objectContaining({ code: codes.ALREADY_BOOTED })
		);
	});

	it('names the plugin that failed to load', async () => {
		const app = testApp();
		app.register(
			definePlugin(
				() => {
					throw new Error('boom');
				},
				{ name: 'broken' }
			)
		);
		const error = await rejects(app.load(), codes.PLUGIN_FAILED);
		expect(error.plugin).toBe('broken');
		expect(error.message).toContain('boom');
		expect((error.cause as Error).message).toBe('boom');
	});

	it('times out a plugin that never finishes, naming it', async () => {
		const app = testApp({ pluginTimeout: 20 });
		app.register(definePlugin(() => new Promise(() => {}), { name: 'slow' }));
		const error = await rejects(app.load(), codes.PLUGIN_TIMEOUT);
		expect(error.message).toContain('slow');
	});

	it('checks the core version range', async () => {
		const app = testApp({ coreVersion: '1.4.0' });
		app.register(definePlugin(() => {}, { name: 'ok', core: '^1.2.0' }));
		app.register(definePlugin(() => {}, { name: 'old', core: '^2.0.0' }));
		const error = await rejects(app.load(), codes.PLUGIN_VERSION_MISMATCH);
		expect(error.plugin).toBe('old');
	});

	it("rejects a core range it can't read instead of calling it a mismatch", async () => {
		const app = testApp({ coreVersion: '1.4.0' });
		app.register(definePlugin(() => {}, { name: 'odd', core: 'latest' }));
		const error = await rejects(app.load(), codes.PLUGIN_META);
		expect(error.plugin).toBe('odd');
		expect(error.message).toContain('unsupported @xcwds/core range: "latest"');
	});

	it('keeps rejecting after a failed load, with the first error', async () => {
		const app = testApp();
		app.register(definePlugin(() => {}, { name: 'old', core: '^9.0.0' }));
		const first = await rejects(app.load(), codes.PLUGIN_VERSION_MISMATCH);
		await expect(app.load()).rejects.toBe(first);
		await expect(app.ready()).rejects.toBe(first);
	});

	it('checks dependencies are registered first', async () => {
		const shell = definePlugin(() => {}, { name: 'shell', encapsulate: false });
		const timers = definePlugin(() => {}, { name: 'timers', dependencies: ['shell'] });
		const good = testApp();
		good.register(shell).register(timers);
		await expect(good.load()).resolves.toBe(good);

		const bad = testApp();
		bad.register(timers).register(shell);
		await rejects(bad.load(), codes.PLUGIN_DEPENDENCY);
	});

	it('sees dependencies registered by an ancestor, not by a sibling scope', async () => {
		const dep = definePlugin(() => {}, { name: 'dep' });
		const needs = definePlugin(() => {}, { name: 'needs', dependencies: ['dep'] });
		const app = testApp();
		app.register(dep);
		app.register((a) => void a.register(needs));
		await expect(app.load()).resolves.toBe(app);

		const isolated = testApp();
		isolated.register((a) => void a.register(dep));
		isolated.register((a) => void a.register(needs));
		await rejects(isolated.load(), codes.PLUGIN_DEPENDENCY);
	});

	it('refuses the same named plugin twice in one scope, allows it in separate scopes', async () => {
		const p = definePlugin(() => {}, { name: 'p' });
		const twice = testApp();
		twice.register(p).register(p);
		await rejects(twice.load(), codes.PLUGIN_DUPLICATE);

		const apart = testApp();
		apart.register((a) => void a.register(p));
		apart.register((a) => void a.register(p));
		await expect(apart.load()).resolves.toBe(apart);
	});

	it('checks required decorators', async () => {
		const needsToast = definePlugin(() => {}, { name: 'n', decorators: ['toast'] });
		const app = testApp();
		app.register(needsToast);
		await rejects(app.load(), codes.PLUGIN_DECORATOR_MISSING);
	});

	it('rejects non-functions', () => {
		expect(() => testApp().register('nope' as never)).toThrowError(
			expect.objectContaining({ code: codes.PLUGIN_NOT_A_FUNCTION })
		);
		expect(() => definePlugin('nope' as never)).toThrow(XcwdsError);
	});

	it('closes once, running onClose hooks in reverse order', async () => {
		const order: string[] = [];
		const app = testApp();
		app.register((a) => void a.addHook('onClose', () => void order.push('first')));
		app.register((a) => void a.addHook('onClose', () => void order.push('second')));
		await app.ready();
		await Promise.all([app.close(), app.close()]);
		expect(order).toEqual(['second', 'first']);
		expect(() => app.register(() => {})).toThrowError(
			expect.objectContaining({ code: codes.CLOSED })
		);
	});

	it('refuses a register after the plugin has finished loading, instead of dropping it', async () => {
		const app = testApp();
		let late: App | undefined;
		app.register(definePlugin((a) => void (late = a), { name: 'early' }));
		app.register(definePlugin(() => {}, { name: 'other' }));
		await app.ready();
		const error = (() => {
			try {
				late!.register(definePlugin(() => {}, { name: 'late' }));
			} catch (e) {
				return e as XcwdsError;
			}
		})();
		expect(error?.code).toBe(codes.ALREADY_BOOTED);
	});

	it('refuses a register from a finished plugin while siblings still load', async () => {
		const app = testApp();
		let late: App | undefined;
		let caught: unknown;
		app.register(definePlugin((a) => void (late = a), { name: 'first' }));
		app.register(
			definePlugin(
				() => {
					try {
						late!.register(definePlugin(() => {}, { name: 'late' }));
					} catch (e) {
						caught = e;
					}
				},
				{ name: 'second' }
			)
		);
		await app.ready();
		expect((caught as XcwdsError).code).toBe(codes.ALREADY_BOOTED);
	});

	it('refuses two different plugins sharing a storage namespace', async () => {
		const app = testApp();
		app.register(definePlugin(() => {}, { name: '@a/timer' }));
		app.register(definePlugin(() => {}, { name: '@b/timer' }));
		const error = await rejects(app.ready(), codes.PLUGIN_NAMESPACE);
		expect(error.message).toContain('@a/timer');
		expect(error.message).toContain('@b/timer');
	});

	it('lets one plugin use its namespace in separate scopes', async () => {
		const app = testApp();
		const timer = definePlugin(() => {}, { name: 'timer' });
		app.register((a) => void a.register(timer));
		app.register((a) => void a.register(timer));
		app.register(definePlugin(() => {}, { name: 'other', namespace: 'other-ns' }));
		await expect(app.ready()).resolves.toBe(app);
	});
});

describe('decorators and encapsulation', () => {
	it('keeps an encapsulated plugin’s decorators to itself and its children', async () => {
		const seen: Record<string, boolean> = {};
		const app = testApp();
		app.register((a) => {
			a.decorate('secret', 1);
			a.register((child) => void (seen.child = child.hasDecorator('secret')));
		});
		app.register((b) => void (seen.sibling = b.hasDecorator('secret')));
		await app.ready();
		expect(seen).toEqual({ child: true, sibling: false });
		expect(app.hasDecorator('secret')).toBe(false);
	});

	it('lets `encapsulate: false` plugins decorate the scope they were registered in', async () => {
		const app = testApp();
		app.register(
			definePlugin((a) => void a.decorate('toast', (m: string) => m), {
				name: 'toast',
				encapsulate: false
			})
		);
		let fromSibling: unknown;
		app.register((b) => void (fromSibling = b.toast?.('hi')));
		await app.ready();
		expect(fromSibling).toBe('hi');
		expect(app.hasDecorator('toast')).toBe(true);
	});

	it('refuses to overwrite a decorator or the app’s own API', () => {
		const app = testApp();
		app.decorate('x', 1);
		expect(() => app.decorate('x', 2)).toThrowError(
			expect.objectContaining({ code: codes.DECORATOR_EXISTS })
		);
		expect(() => app.decorate('register' as string, 2)).toThrowError(
			expect.objectContaining({ code: codes.DECORATOR_RESERVED })
		);
		expect(() => app.decorate('__proto__', 2)).toThrowError(
			expect.objectContaining({ code: codes.DECORATOR_RESERVED })
		);
		expect(() => app.decorate('isPrototypeOf', 2)).toThrowError(
			expect.objectContaining({ code: codes.DECORATOR_RESERVED })
		);
		expect(app.hasDecorator('register')).toBe(false);
	});

	it('doesn’t count Object.prototype’s names as decorators', async () => {
		const app = testApp();
		app.decorate('x', 1);
		const names = ['toString', 'isPrototypeOf', 'toLocaleString', 'constructor', '__proto__'];
		let child: Record<string, boolean> = {};
		app.register((a) => {
			child = Object.fromEntries([...names, 'x'].map((n) => [n, a.hasDecorator(n)]));
		});
		await app.load();
		for (const name of names) expect(app.hasDecorator(name), name).toBe(false);
		expect(child).toEqual({ ...Object.fromEntries(names.map((n) => [n, false])), x: true });
		const needs = definePlugin(() => {}, { name: 'needs', decorators: ['toLocaleString'] });
		const other = testApp().register(needs);
		await rejects(other.load(), codes.PLUGIN_DECORATOR_MISSING);
	});

	it('types merged decorators', () => {
		expectTypeOf<App['toast']>().toEqualTypeOf<((message: string) => void) | undefined>();
		// @ts-expect-error A merged decorator is typed: a number isn't a function.
		const typed = () => testApp().decorate('toast', 1);
		expect(typed).not.toThrow();
	});

	it('gives each named plugin its own storage namespace', async () => {
		const keys: string[] = [];
		const app = testApp();
		app.register(
			definePlugin((a) => void keys.push(a.storage.entry('n', { label: 'n', parse: Number }).key), {
				name: '@xcwds/plugin-timers'
			})
		);
		app.register(
			definePlugin((a) => void keys.push(a.storage.entry('n', { label: 'n', parse: Number }).key), {
				name: 'mine',
				namespace: 'custom'
			})
		);
		await app.load();
		keys.push(app.storage.entry('n', { label: 'n', parse: Number }).key);
		expect(keys).toEqual(['app:timers:n', 'app:custom:n', 'app:n']);
	});

	it('derives short namespaces from plugin names', () => {
		expect(defaultNamespace('@xcwds/plugin-timers')).toBe('timers');
		expect(defaultNamespace('xcwds-plugin-recipes')).toBe('recipes');
		expect(defaultNamespace('My_Thing')).toBe('my-thing');
	});
});

describe('hooks', () => {
	it('runs hooks in registration order', async () => {
		const order: string[] = [];
		const app = testApp();
		app.addHook('onBoot', () => void order.push('root'));
		app.register((a) => void a.addHook('onBoot', async () => void order.push('plugin')));
		await app.load();
		await app.hooks.run('onBoot', []);
		expect(order).toEqual(['root', 'plugin']);
	});

	it('only runs route hooks for paths under the plugin’s prefix', async () => {
		const seen: string[] = [];
		const app = testApp();
		app.register(
			(a) => void a.addHook('afterNavigate', (to) => void seen.push(`timer:${to.path}`)),
			{
				prefix: '/utils/timer'
			}
		);
		app.register((a) => void a.addHook('afterNavigate', (to) => void seen.push(`all:${to.path}`)));
		await app.load();
		await app.hooks.run('afterNavigate', [{ path: '/utils/timer' }], { path: '/utils/timer' });
		await app.hooks.run('afterNavigate', [{ path: '/utils/timerx' }], { path: '/utils/timerx' });
		expect(seen).toEqual(['timer:/utils/timer', 'all:/utils/timer', 'all:/utils/timerx']);
		expect(app.hooks.plugins('afterNavigate', { path: '/' })).toEqual(['anonymous plugin']);
	});

	it('returns the first answer, skipping hooks that fail', async () => {
		const errors: unknown[] = [];
		const app = testApp();
		app.addHook('onError', (e) => void errors.push(e));
		app.register(
			definePlugin(
				(a) => {
					a.addHook('onFetch', () => {
						throw new Error('bad');
					});
				},
				{ name: 'flaky' }
			)
		);
		app.register((a) => void a.addHook('onFetch', () => new Response('ok')));
		app.register((a) => void a.addHook('onFetch', () => new Response('late')));
		await app.load();
		const url = new URL('https://x.test/a');
		const res = await app.hooks.first('onFetch', [new Request(url), url]);
		expect(await res?.text()).toBe('ok');
		expect(errors).toHaveLength(1);
		expect((errors[0] as XcwdsError).code).toBe(codes.HOOK_FAILED);
		expect((errors[0] as XcwdsError).message).toContain('onFetch hook from "flaky" failed: bad');
	});

	it('collects reasons from every hook', async () => {
		const app = testApp();
		app.addHook('onBeforeReload', () => 'A timer is running');
		app.addHook('onBeforeReload', () => undefined);
		app.addHook('onBeforeReload', async () => 'Saving');
		expect(await app.hooks.collect('onBeforeReload', [])).toEqual(['A timer is running', 'Saving']);
	});

	it('answers synchronously until a hook returns a promise', async () => {
		const errors: unknown[] = [];
		const app = testApp();
		app.addHook('onError', (e) => void errors.push(e));
		app.addHook('onNavigate', (to) => (to.path === '/sync' ? '/a' : undefined));
		app.addHook('onNavigate', (to) => {
			if (to.path === '/throws') throw new Error('bad');
		});
		app.addHook('onNavigate', async (to) => (to.path === '/async' ? false : undefined));
		app.addHook('onNavigate', (to) => (to.path === '/late' ? '/b' : undefined));
		expect(app.hooks.firstNow('onNavigate', [{ path: '/sync' }, null])).toBe('/a');
		const late = app.hooks.firstNow('onNavigate', [{ path: '/late' }, null]);
		expect(late).toBeInstanceOf(Promise);
		expect(await late).toBe('/b');
		expect(await app.hooks.firstNow('onNavigate', [{ path: '/async' }, null])).toBe(false);
		expect(await app.hooks.firstNow('onNavigate', [{ path: '/throws' }, null])).toBeUndefined();
		expect(errors).toHaveLength(1);
		expect(testApp().hooks.firstNow('onNavigate', [{ path: '/' }, null])).toBeUndefined();
	});

	it('reduces a value through every hook in order', async () => {
		const errors: unknown[] = [];
		const app = testApp();
		app.addHook('onError', (e) => void errors.push(e));
		app.addHook('onManifest', (m) => ({ ...m, name: 'A' }));
		app.addHook('onManifest', () => undefined);
		app.addHook('onManifest', () => {
			throw new Error('bad');
		});
		app.addHook('onManifest', async (m) => ({ ...m, short_name: `${String(m.name)}!` }));
		expect(await app.hooks.reduce('onManifest', { name: 'x', lang: 'en' })).toEqual({
			name: 'A',
			short_name: 'A!',
			lang: 'en'
		});
		expect(errors).toHaveLength(1);
		expect(await testApp().hooks.reduce('onConfig', { a: 1 })).toEqual({ a: 1 });
	});

	it('logs errors when nobody handles them, and never loops on a failing onError', async () => {
		const error = vi.fn();
		const app = testApp();
		(app.log as { error: unknown }).error = error;
		app.addHook('onBoot', () => {
			throw new Error('first');
		});
		await app.hooks.run('onBoot', []);
		expect(error).toHaveBeenCalledTimes(1);

		app.addHook('onError', () => {
			throw new Error('handler');
		});
		await app.reportError(new Error('second'));
		expect(error).toHaveBeenCalledTimes(2);
	});

	it('rejects unknown hooks unless defined, and non-functions', () => {
		const app = testApp();
		const addCustom = () =>
			(app.addHook as (n: string, f: () => void) => App)('onWhatever', () => {});
		expect(addCustom).toThrowError(expect.objectContaining({ code: codes.HOOK_INVALID }));
		app.defineHook('onWhatever', { route: true });
		expect(addCustom).not.toThrow();
		expect(() => app.defineHook('onReady')).toThrow(XcwdsError);
		expect(() => app.addHook('onReady', 1 as never)).toThrow(XcwdsError);
	});

	it('turns settings and other tabs’ storage changes into hooks', async () => {
		const storage = memoryStorage();
		const app = createApp({ storage, logLevel: 'silent' });
		const changes: unknown[] = [];
		app.register((a) => {
			a.settings.field('theme', {
				default: 'system',
				parse: (v) => (v === 'light' || v === 'dark' || v === 'system' ? v : undefined)
			});
			a.addHook('onSettingsChange', (next, prev) => void changes.push([prev.theme, next.theme]));
		});
		await app.ready();
		app.settings.set({ theme: 'dark' });
		await new Promise((r) => setTimeout(r));
		expect(changes).toEqual([['system', 'dark']]);
		expect(storage.data.get('app:settings')).toBe('{"theme":"dark"}');
	});
});
