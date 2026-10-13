/**
 * The page entry, ported from xcwds.github.io's `cooking-timers.svelte.ts` and `alarm.ts`: the
 * app's one list of timers (`app.timers`), saved with their end times so a reload or a suspended
 * tab resumes them. The app owns them, not a page, so on every page a finished timer rings, a
 * running one keeps the screen awake, and an app update waits (`onBeforeReload`).
 *
 * Imported at prerender too, so it only touches browser globals once the app boots.
 */
import { definePlugin } from '@xcwds/core';
import {
	DEFAULT_ALARM,
	CORE,
	NAME,
	parseAlarm,
	resolveOptions,
	type AlarmSetting,
	type TimersOptions
} from './options.js';
import * as t from './timer.js';
import type { TimerState } from './timer.js';

export type TimerItem = {
	readonly id: number;
	readonly label: string;
	readonly state: TimerState;
	/**
	 * The page it was started on (an app path), so a locked app can hide its label. Timers saved
	 * before it was recorded have none, and count as started on a page that isn't private.
	 */
	readonly path?: string;
};

/** `app.timers`. */
export type AppTimers = {
	/** The timers page from the options (an app path), or null. */
	readonly page: string | null;
	/** Every timer, oldest first. */
	list(): readonly TimerItem[];
	get(id: number): TimerItem | undefined;
	/**
	 * Calls `listener` now, on every change and, while a timer runs, a few times a second (so
	 * remaining times stay current); returns a function that stops it.
	 */
	subscribe(listener: (items: readonly TimerItem[]) => void): () => void;
	/** The time `remaining()` and `ringing()` use: the clock at the latest tick. */
	now(): number;
	remaining(item: TimerItem): number;
	ringing(item: TimerItem): boolean;
	anyRunning(): boolean;
	/**
	 * Starts a new timer of `ms` (up to 7 days); returns it, or undefined for no time. Call it
	 * from a tap, so the alarm can play sound later (iOS).
	 */
	create(label: string, ms: number): TimerItem | undefined;
	/** Pauses a running timer, or starts a paused one (also from a tap). */
	toggle(id: number): void;
	/** Adds (or removes, with a negative `ms`) time; on a finished timer, snoozes it. */
	add(id: number, ms: number): void;
	/** Back to its full duration, paused. */
	reset(id: number): void;
	remove(id: number): void;
	/**
	 * Says a page shows every timer, so finished ones aren't also shown as alerts (what
	 * `<TimerList>` does); returns a function that undoes it.
	 */
	show(): () => void;
	/** Whether a page shows every timer now. */
	shown(): boolean;
};

declare module '@xcwds/core' {
	interface Settings {
		/** From `@xcwds/plugin-timers`. */
		alarm: AlarmSetting;
	}
	interface App {
		/** From `@xcwds/plugin-timers`. */
		readonly timers?: AppTimers;
	}
}

/** How often running timers tick, in ms. */
const TICK = 200;
/** How often a finished timer beeps again, in ms. */
const RING_EVERY = 3000;

function parseItems(v: unknown): TimerItem[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const items: TimerItem[] = [];
	for (const raw of v) {
		if (typeof raw !== 'object' || raw === null) continue;
		const { id, label, state, path } = raw as Record<string, unknown>;
		const parsed = t.parseTimer(state);
		if (typeof id !== 'number' || !Number.isFinite(id) || typeof label !== 'string' || !parsed)
			continue;
		if (items.some((i) => i.id === id)) continue;
		items.push({ id, label, state: parsed, ...(typeof path === 'string' ? { path } : {}) });
	}
	return items;
}

export default definePlugin(
	(app, input: TimersOptions) => {
		const options = resolveOptions(input);
		app.settings.field('alarm', {
			default: DEFAULT_ALARM,
			parse: parseAlarm,
			label: 'Timer alarm',
			section: 'timers',
			control: {
				type: 'switches',
				options: [
					{ key: 'sound', label: 'Alarm sound', hint: 'Beep when a timer finishes.' },
					{ key: 'vibration', label: 'Vibration', hint: "Android only; iPhones don't allow it." },
					{ key: 'keepAwake', label: 'Keep screen on', hint: 'While a timer is running.' }
				]
			}
		});
		const entry = app.storage.entry('timers', {
			label: 'Timers',
			parse: parseItems,
			...(options.storageKey ? { key: options.storageKey } : {})
		});

		let items: TimerItem[] = [];
		let now = Date.now();
		let shows = 0;
		const listeners = new Set<(items: readonly TimerItem[]) => void>();
		const notify = () => {
			for (const listener of listeners) listener(items);
		};

		// Browser-only pieces, set up on boot.
		let audio: AudioContext | undefined;
		let tick: ReturnType<typeof setInterval> | undefined;
		let lastBeep = -Infinity;
		let wakeLock: WakeLockSentinel | undefined;
		let booted = false;

		const anyRunning = () => items.some((i) => t.running(i.state));
		const anyRinging = () => items.some((i) => t.ringing(i.state, now));

		function primeAudio() {
			try {
				audio ??= new AudioContext();
				if (audio.state === 'suspended') void audio.resume();
			} catch {
				// No audio; the alarm falls back to vibration and the alert.
			}
		}

		function beep(count: number) {
			const alarm = app.settings.get().alarm ?? DEFAULT_ALARM;
			if (alarm.vibration)
				try {
					navigator.vibrate?.(Array.from({ length: count * 2 - 1 }, (_, i) => (i % 2 ? 150 : 300)));
				} catch {
					// Vibration unsupported (e.g. iOS Safari).
				}
			if (!audio || !alarm.sound) return;
			const start = audio.currentTime + 0.05;
			for (let i = 0; i < count; i++) {
				const at = start + i * 0.45;
				const osc = audio.createOscillator();
				const gain = audio.createGain();
				osc.frequency.value = 880;
				gain.gain.setValueAtTime(0.0001, at);
				gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
				gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
				osc.connect(gain).connect(audio.destination);
				osc.start(at);
				osc.stop(at + 0.32);
			}
		}

		/** Keeps the screen awake while a timer runs and the page shows, if the setting allows. */
		async function syncWakeLock() {
			const alarm = app.settings.get().alarm ?? DEFAULT_ALARM;
			const want =
				booted && alarm.keepAwake && anyRunning() && document.visibilityState === 'visible';
			try {
				if (want && !wakeLock && 'wakeLock' in navigator) {
					const lock = await navigator.wakeLock.request('screen');
					lock.addEventListener('release', () => {
						if (wakeLock === lock) wakeLock = undefined;
					});
					// Stopped meanwhile: let it go again.
					if (!booted || !anyRunning()) void lock.release();
					else wakeLock = lock;
				} else if (!want && wakeLock) {
					const lock = wakeLock;
					wakeLock = undefined;
					await lock.release();
				}
			} catch {
				// Denied (low battery, unsupported); timers still work.
			}
		}

		function step() {
			now = Date.now();
			if (anyRinging()) {
				// Keep beeping until every finished timer is stopped or snoozed.
				if (now - lastBeep >= RING_EVERY) {
					lastBeep = now;
					beep(2);
				}
			} else lastBeep = -Infinity;
			notify();
		}

		/** Ticks while a timer runs (and only after boot: prerender has no clock to follow). */
		function changed() {
			if (booted) {
				const want = anyRunning();
				if (want && tick === undefined) tick = setInterval(step, TICK);
				else if (!want && tick !== undefined) {
					clearInterval(tick);
					tick = undefined;
				}
				void syncWakeLock();
				step();
			} else notify();
		}

		const load = () => {
			items = app.storage.read(entry) ?? [];
			changed();
		};

		/**
		 * Applies `change` to the latest saved timers (so another tab's changes aren't lost) and
		 * saves them; a failed save is reported once.
		 */
		function apply(change: (items: TimerItem[]) => TimerItem[]) {
			now = Date.now();
			const storage = app.storage;
			const unsaved = storage.hasUnsavedChanges(entry);
			const { value, saved } = storage.update(entry, items, (v) => change(v ?? []), { unsaved });
			items = value ?? [];
			storage.saveResult(entry, saved);
			changed();
		}

		const update = (id: number, change: (state: TimerState) => TimerState) =>
			apply((list) => list.map((i) => (i.id === id ? { ...i, state: change(i.state) } : i)));

		/**
		 * The page showing now, which new timers record. `@xcwds/plugin-lock` follows every page,
		 * even with this plugin under a route prefix (whose route hooks only see paths below it).
		 */
		let seen: string | undefined;
		app.addHook('afterNavigate', (to) => void (seen = to.path));
		const here = () => (app as { lock?: { here(): string | undefined } }).lock?.here() ?? seen;

		const timers: AppTimers = {
			page: options.page,
			list: () => items,
			get: (id) => items.find((i) => i.id === id),
			subscribe(listener) {
				listeners.add(listener);
				listener(items);
				return () => void listeners.delete(listener);
			},
			now: () => now,
			remaining: (item) => t.remaining(item.state, now),
			ringing: (item) => t.ringing(item.state, now),
			anyRunning,
			create(label, ms) {
				if (!Number.isFinite(ms) || ms <= 0) return undefined;
				primeAudio();
				const duration = Math.min(Math.round(ms), t.MAX_DURATION);
				const path = here();
				const created: TimerItem = {
					// Unique across tabs and reloads, and still a plain number for the saved shape.
					id: Date.now() + Math.random(),
					label: label.trim() || `${t.formatDuration(duration)} timer`,
					state: t.start(t.timer(duration), Date.now()),
					...(path === undefined ? {} : { path })
				};
				apply((list) => [...list, created]);
				return created;
			},
			toggle(id) {
				primeAudio();
				const at = Date.now();
				update(id, (s) => (t.running(s) ? t.pause(s, at) : t.start(s, at)));
			},
			add: (id, ms) => {
				const at = Date.now();
				update(id, (s) => t.add(s, ms, at));
			},
			reset: (id) => update(id, (s) => t.reset(s)),
			remove: (id) => apply((list) => list.filter((i) => i.id !== id)),
			show() {
				shows++;
				notify();
				let done = false;
				return () => {
					if (done) return;
					done = true;
					shows--;
					notify();
				};
			},
			shown: () => shows > 0
		};
		app.decorate('timers', timers);

		const stops: (() => void)[] = [];
		app.addHook('onBoot', () => {
			booted = true;
			load();
			stops.push(
				app.storage.onChange((key) => {
					if (key === null || key === entry.key) load();
				}),
				app.settings.subscribe(() => void syncWakeLock())
			);
		});
		// A reload would stop the alarm and the wake lock until the page loads again.
		app.addHook('onBeforeReload', () => (anyRunning() ? 'running timers' : undefined));
		// The browser drops a wake lock when the page is hidden; take it again once it shows.
		app.addHook('onVisible', () => syncWakeLock());
		app.addHook('onClose', () => {
			booted = false;
			clearInterval(tick);
			tick = undefined;
			for (const stop of stops.splice(0)) stop();
			const lock = wakeLock;
			wakeLock = undefined;
			void lock?.release().catch(() => {});
			void audio?.close().catch(() => {});
			audio = undefined;
		});
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
