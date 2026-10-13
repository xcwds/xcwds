import { definePlugin, memoryStorage } from '@xcwds/core';
import { buildTestApp, type Importer } from '@xcwds/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import client from './client.js';
import timersFactory from './index.js';
import { parseAlarm, resolveOptions } from './options.js';
import * as t from './timer.js';

afterEach(() => void vi.unstubAllGlobals());

const importer: Importer = async (id) => {
	const entries: Record<string, () => Promise<Record<string, unknown>>> = {
		'@xcwds/plugin-timers': () => import('./index.js'),
		'@xcwds/plugin-timers/client': () => import('./client.js')
	};
	const load = entries[id];
	if (!load) throw Object.assign(new Error(id), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
	return load();
};

const NOW = Date.UTC(2026, 4, 1, 8);

describe('options', () => {
	it('fills in defaults and refuses mistakes', async () => {
		expect(resolveOptions()).toEqual({ page: null, storageKey: undefined });
		expect(
			resolveOptions({ page: '/utils/timer', storageKey: 'app:cooking-timer:timers' })
		).toEqual({ page: '/utils/timer', storageKey: 'app:cooking-timer:timers' });
		expect(() => resolveOptions({ page: 'timer' })).toThrow(/`page`/);
		expect(() => resolveOptions({ storageKey: 'timers' })).toThrow(/`storageKey`/);
		expect(() => resolveOptions({ sound: true })).toThrow(/unknown option `sound`/);
		await expect(
			buildTestApp({ plugins: [timersFactory({ page: 'x' })] }, { import: importer })
		).rejects.toThrow(/@xcwds\/plugin-timers: `page`/);
	});

	it('reads the alarm setting, with missing fields at their defaults', () => {
		expect(parseAlarm({ sound: false })).toEqual({
			sound: false,
			vibration: true,
			keepAwake: true
		});
		expect(parseAlarm({ sound: 'no' })).toBeUndefined();
		expect(parseAlarm(null)).toBeUndefined();
	});
});

// Ported from xcwds.github.io's Timer tests.
describe('a timer', () => {
	it('counts against its end time, pauses and resumes', () => {
		let s = t.start(t.timer(90_000), NOW);
		expect(t.remaining(s, NOW + 30_000)).toBe(60_000);
		s = t.pause(s, NOW + 30_000);
		expect(t.running(s)).toBe(false);
		// Paused time doesn't count.
		expect(t.remaining(s, NOW + 999_000)).toBe(60_000);
		s = t.start(s, NOW + 100_000);
		expect(t.remaining(s, NOW + 160_000)).toBe(0);
		expect(t.ringing(s, NOW + 160_000)).toBe(true);
		expect(t.remaining(s, NOW + 170_000)).toBe(-10_000);
		// Paused after running over: at zero, and still a valid saved state.
		const over = t.pause(s, NOW + 170_000);
		expect(over.pausedRemaining).toBe(0);
		expect(t.parseTimer(JSON.parse(JSON.stringify(over)))).toEqual(over);
		expect(t.ringing(t.start(over, NOW + 200_000), NOW + 200_000)).toBe(true);
		expect(t.reset(s)).toEqual(t.timer(90_000));
		expect(t.start(s, NOW + 999_000)).toBe(s);
		expect(t.pause(t.timer(1), NOW)).toEqual(t.timer(1));
	});

	it('adds and removes time, and snoozes once finished', () => {
		const s = t.start(t.timer(60_000), NOW);
		expect(t.remaining(t.add(s, 30_000, NOW), NOW)).toBe(90_000);
		expect(t.remaining(t.add(s, -90_000, NOW), NOW)).toBe(0);
		// Ran over by 5 minutes; +1 min rings again a minute from now.
		const later = NOW + 6 * t.MINUTE;
		expect(t.remaining(t.add(s, t.MINUTE, later), later)).toBe(t.MINUTE);
		expect(t.add(t.timer(1000), 500, NOW).pausedRemaining).toBe(1500);
		expect(t.add(s, Infinity, NOW).endsAt).toBe(NOW + t.MAX_DURATION);
	});

	it('formats and validates', () => {
		expect(t.formatDuration(90_000)).toBe('1:30');
		expect(t.formatDuration(1)).toBe('0:01');
		expect(t.formatDuration(-5)).toBe('0:00');
		expect(t.formatDuration(3_723_000)).toBe('1:02:03');
		expect(t.parseTimer({ duration: 1, endsAt: null, pausedRemaining: 1 })).toBeTruthy();
		expect(t.parseTimer({ duration: -1, endsAt: null, pausedRemaining: 1 })).toBeUndefined();
		expect(t.parseTimer({ duration: 1, endsAt: 'x', pausedRemaining: 1 })).toBeUndefined();
		expect(t.parseTimer(null)).toBeUndefined();
	});
});

/** Fakes what the alarm uses: vibration, audio, the wake lock and page visibility. */
function fakeDevice() {
	const vibrations: unknown[] = [];
	const beeps: number[] = [];
	const locks = { held: 0, requests: 0 };
	class FakeAudio {
		state = 'running';
		currentTime = 0;
		destination = {};
		createOscillator() {
			const osc = {
				frequency: { value: 0 },
				connect: (g: unknown) => g,
				start: () => void beeps.push(Date.now()),
				stop() {}
			};
			return osc;
		}
		createGain() {
			return {
				gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
				connect: (d: unknown) => d
			};
		}
		async resume() {}
		async close() {}
	}
	const page = { visibilityState: 'visible' };
	vi.stubGlobal('AudioContext', FakeAudio);
	vi.stubGlobal('document', page);
	vi.stubGlobal('navigator', {
		vibrate: (pattern: unknown) => void vibrations.push(pattern),
		wakeLock: {
			async request() {
				locks.requests++;
				locks.held++;
				let released = false;
				const lock = Object.assign(new EventTarget(), {
					async release() {
						if (released) return;
						released = true;
						locks.held--;
						lock.dispatchEvent(new Event('release'));
					}
				});
				return lock;
			}
		}
	});
	return { vibrations, beeps, locks, page };
}

describe('the page', () => {
	it('keeps counting while the tab sleeps, and rings until stopped', async () => {
		const device = fakeDevice();
		const app = await buildTestApp({ plugins: [[client, {}]] }, { now: NOW });
		const timers = app.timers!;
		const item = timers.create('Eggs', 2 * t.MINUTE)!;
		expect(item.label).toBe('Eggs');
		await app.clock!.advance(30_000);
		expect(timers.remaining(timers.get(item.id)!)).toBe(90_000);

		// The phone sleeps for 5 minutes: no ticks, but the wall clock moves on.
		app.clock!.jump(5 * t.MINUTE);
		await app.clock!.advance(200);
		expect(timers.ringing(timers.get(item.id)!)).toBe(true);
		expect(device.beeps.length).toBe(2);
		expect(device.vibrations).toHaveLength(1);
		// Beeps again every 3 seconds.
		await app.clock!.advance(3000);
		expect(device.beeps.length).toBe(4);

		// Snoozed: quiet for a minute, then rings again.
		timers.add(item.id, t.MINUTE);
		await app.clock!.advance(30_000);
		expect(device.beeps.length).toBe(4);
		await app.clock!.advance(30_200);
		expect(device.beeps.length).toBe(6);
		timers.remove(item.id);
		await app.clock!.advance(10_000);
		expect(device.beeps.length).toBe(6);
		expect(timers.list()).toEqual([]);
	});

	it('resumes after a reload, ringing for a timer that finished meanwhile', async () => {
		fakeDevice();
		const storage = memoryStorage();
		const app = await buildTestApp({ plugins: [[client, {}]] }, { now: NOW, storage });
		const short = app.timers!.create('Short', t.MINUTE)!;
		const long = app.timers!.create('', 10 * t.MINUTE)!;
		expect(long.label).toBe('10:00 timer');
		app.timers!.toggle(long.id);
		await app.close();

		const reloaded = await buildTestApp(
			{ plugins: [[client, {}]] },
			{ now: NOW + 2 * t.MINUTE, storage }
		);
		const timers = reloaded.timers!;
		expect(timers.list().map((i) => i.label)).toEqual(['Short', '10:00 timer']);
		expect(timers.ringing(timers.get(short.id)!)).toBe(true);
		// The paused one hasn't moved.
		expect(timers.remaining(timers.get(long.id)!)).toBe(10 * t.MINUTE);
	});

	it('records the page a timer was started on, and keeps it across a reload', async () => {
		fakeDevice();
		const storage = memoryStorage({
			// Saved before timers recorded their page: it still loads, with none.
			'app:cooking-timer:timers': JSON.stringify([
				{ id: 1, label: 'Old', state: { duration: 1000, endsAt: null, pausedRemaining: 1000 } },
				{
					id: 2,
					label: 'Odd',
					path: 42,
					state: { duration: 1000, endsAt: null, pausedRemaining: 1000 }
				}
			])
		});
		const plugins = [[client, { storageKey: 'app:cooking-timer:timers' }]] as const;
		const app = await buildTestApp({ plugins: [...plugins] }, { now: NOW, storage });
		await app.hooks.run('afterNavigate', [{ path: '/journal' }], { path: '/journal' });
		app.timers!.create('Breathe', t.MINUTE);
		expect(app.timers!.list().map((i) => [i.label, i.path])).toEqual([
			['Old', undefined],
			['Odd', undefined],
			['Breathe', '/journal']
		]);
		await app.close();
		const reloaded = await buildTestApp({ plugins: [...plugins] }, { now: NOW, storage });
		expect(reloaded.timers!.list().at(-1)!.path).toBe('/journal');
	});

	it('asks the lock for the page when it runs under a route prefix', async () => {
		fakeDevice();
		// Stands in for @xcwds/plugin-lock, which follows every page.
		let page: string | undefined;
		const lock = definePlugin(
			(app) => {
				app.decorate('lock', { here: () => page });
				app.addHook('afterNavigate', (to) => void (page = to.path));
			},
			{ name: 'fake-lock', encapsulate: false }
		);
		const app = await buildTestApp(
			{
				plugins: [
					[lock, {}],
					[client, { prefix: '/utils/timer' }]
				]
			},
			{ now: NOW }
		);
		// The timers' own route hooks don't see this page.
		await app.hooks.run('afterNavigate', [{ path: '/journal' }], { path: '/journal' });
		expect(app.timers!.create('Breathe', t.MINUTE)!.path).toBe('/journal');
	});

	it('keeps an app update waiting while a timer runs', async () => {
		fakeDevice();
		const app = await buildTestApp({ plugins: [[client, {}]] }, { now: NOW });
		const reasons = () => app.hooks.collect('onBeforeReload', []);
		expect(await reasons()).toEqual([]);
		const item = app.timers!.create('Rice', t.MINUTE)!;
		expect(await reasons()).toEqual(['running timers']);
		app.timers!.toggle(item.id);
		expect(await reasons()).toEqual([]);
	});

	it('holds the wake lock while a timer runs and the page shows, per the setting', async () => {
		const device = fakeDevice();
		const app = await buildTestApp({ plugins: [[client, {}]] }, { now: NOW });
		const item = app.timers!.create('Rice', t.MINUTE)!;
		await vi.waitFor(() => expect(device.locks.held).toBe(1));
		app.timers!.toggle(item.id);
		await vi.waitFor(() => expect(device.locks.held).toBe(0));
		app.timers!.toggle(item.id);
		await vi.waitFor(() => expect(device.locks.held).toBe(1));
		app.settings.set({ alarm: { sound: true, vibration: true, keepAwake: false } });
		await vi.waitFor(() => expect(device.locks.held).toBe(0));
		app.settings.set({ alarm: { sound: true, vibration: false, keepAwake: true } });
		await vi.waitFor(() => expect(device.locks.held).toBe(1));
		await app.close();
		expect(device.locks.held).toBe(0);
	});

	it('follows other tabs, and only alerts where no page shows every timer', async () => {
		fakeDevice();
		const app = await buildTestApp({ plugins: [[client, {}]] }, { now: NOW });
		const other = await app.openTab();
		app.timers!.create('Tea', t.MINUTE);
		await app.settle();
		expect(other.timers!.list().map((i) => i.label)).toEqual(['Tea']);
		other.timers!.remove(other.timers!.list()[0]!.id);
		await app.settle();
		expect(app.timers!.list()).toEqual([]);

		expect(app.timers!.shown()).toBe(false);
		const hide = app.timers!.show();
		expect(app.timers!.shown()).toBe(true);
		hide();
		hide();
		expect(app.timers!.shown()).toBe(false);
	});

	it('ignores nonsense, and drops invalid saved timers', async () => {
		fakeDevice();
		const storage = memoryStorage({
			'app:cooking-timer:timers': JSON.stringify([
				{ id: 1, label: 'Ok', state: { duration: 1000, endsAt: null, pausedRemaining: 1000 } },
				{ id: 1, label: 'Duplicate', state: { duration: 1, endsAt: null, pausedRemaining: 1 } },
				{ id: 2, label: 'Bad', state: { duration: -1 } },
				'junk'
			])
		});
		const app = await buildTestApp(
			{ plugins: [[client, { storageKey: 'app:cooking-timer:timers' }]] },
			{ now: NOW, storage }
		);
		expect(app.timers!.list().map((i) => i.label)).toEqual(['Ok']);
		expect(app.timers!.create('Never', 0)).toBeUndefined();
		expect(app.timers!.create('Never', NaN)).toBeUndefined();
		expect(app.timers!.create('Huge', Infinity)).toBeUndefined();
		expect(app.timers!.create('Long', 30 * 24 * 60 * t.MINUTE)!.state.duration).toBe(
			t.MAX_DURATION
		);
	});

	it('works without audio, vibration or a wake lock', async () => {
		vi.stubGlobal('document', { visibilityState: 'visible' });
		vi.stubGlobal('navigator', {});
		const app = await buildTestApp(
			{ plugins: [[client, {}], definePlugin(() => {})] },
			{ now: NOW }
		);
		app.timers!.create('Plain', 1000);
		await app.clock!.advance(1200);
		expect(app.timers!.ringing(app.timers!.list()[0]!)).toBe(true);
	});
});
