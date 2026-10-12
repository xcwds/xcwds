/**
 * The page entry, ported from xcwds.github.io's `app-update.svelte.ts`. A new version installs
 * in the background and waits; `available` turns on and `<UpdateBanner>` offers it. Update asks
 * the waiting worker to take over (`SKIP_WAITING`) and reloads once it has. Anything a reload
 * would interrupt says so with an `onBeforeReload` hook or `app.update.markBusy()`, and the
 * banner asks the user to finish first.
 *
 * When another tab applies the update, the new worker takes over this one too (the old cache is
 * gone, so lazily loaded code would fail): a hidden, idle tab reloads quietly; otherwise
 * `reloadNeeded` turns on and the banner asks for a reload.
 *
 * Imported at prerender too, so it only touches browser globals once the app boots.
 */
import { definePlugin } from '@xcwds/core';
import {
	CORE,
	JUST_UPDATED,
	NAME,
	SKIP_WAITING,
	resolveOptions,
	type UpdateOptions
} from './options.js';

export type UpdateState = {
	/** A new version is installed and waiting. */
	readonly available: boolean;
	/** Another tab applied the update; this one still runs the old version and should reload. */
	readonly reloadNeeded: boolean;
	/** This page load is the new version, reloaded into by an update (for what's-new notes). */
	readonly justUpdated: boolean;
};

/** `app.update`. */
export type AppUpdate = {
	readonly state: UpdateState;
	/** Calls `listener` now and on every change; returns a function that stops it. */
	subscribe(listener: (state: UpdateState) => void): () => void;
	/** From the options: ask before reloading while something is busy. */
	readonly askBeforeReload: boolean;
	/** Looks for a new version now. */
	check(): Promise<void>;
	/** What a reload would interrupt now: `markBusy` names and `onBeforeReload` reasons. */
	busyReasons(): Promise<string[]>;
	/** Marks `name` busy while `isBusy()` returns true; returns a function that unmarks it. */
	markBusy(name: string, isBusy: () => boolean): () => void;
	/** Switches to the waiting version and reloads (what Update does). */
	apply(): void;
	/** Reloads into the version another tab applied (what Reload does). */
	reload(): void;
	/**
	 * Hands a value to the next version: when this page reloads into an update, `value()` (JSON)
	 * is saved for the new version's `handover()`. Returns a function that stops it.
	 */
	carry(name: string, value: () => unknown): () => void;
	/**
	 * What the previous version carried over when it reloaded into this one (by name), or null
	 * when this page load isn't an update. Browser only; it can be read before the app boots.
	 */
	handover(): Readonly<Record<string, unknown>> | null;
};

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-update`. */
		readonly update?: AppUpdate;
	}
}

export { JUST_UPDATED };

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export default definePlugin(
	(app, input: UpdateOptions) => {
		const options = resolveOptions(input);
		let state: UpdateState = { available: false, reloadNeeded: false, justUpdated: false };
		const listeners = new Set<(state: UpdateState) => void>();
		const set = (patch: Partial<UpdateState>) => {
			state = { ...state, ...patch };
			for (const listener of listeners) listener(state);
		};
		const busy = new Map<string, () => boolean>();
		let waiting: ServiceWorker | null = null;
		let registration: ServiceWorkerRegistration | null = null;
		/** This tab asked the waiting worker to take over, so its controllerchange is expected. */
		let reloading = false;
		let closed = false;
		const stops: (() => void)[] = [];

		async function busyReasons(): Promise<string[]> {
			const named = [...busy]
				.filter(([, isBusy]) => {
					try {
						return isBusy();
					} catch {
						return false;
					}
				})
				.map(([name]) => name);
			const reasons = await app.hooks.collect('onBeforeReload', []);
			const given = reasons.filter((r): r is string => typeof r === 'string' && r !== '');
			return [...new Set([...named, ...given])];
		}

		const carried = new Map<string, () => unknown>();

		function markJustUpdated() {
			const values: Record<string, unknown> = {};
			for (const [name, value] of carried) {
				try {
					values[name] = value();
				} catch (error) {
					app.reportError(error);
				}
			}
			try {
				sessionStorage.setItem(options.marker, JSON.stringify(values));
			} catch {
				// The update still applies; only the "just updated" note is lost.
			}
		}

		/** The marker the previous version left, read (and removed) once. */
		let note: Record<string, unknown> | null | undefined;
		function handover(): Record<string, unknown> | null {
			if (note !== undefined) return note;
			if (typeof sessionStorage === 'undefined') return null;
			let text: string | null;
			try {
				text = sessionStorage.getItem(options.marker);
				sessionStorage.removeItem(options.marker);
			} catch {
				return (note = null);
			}
			if (text === null) return (note = null);
			let parsed: unknown;
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = null;
			}
			// Older versions wrote "1": an update with nothing carried over.
			return (note = Object.freeze(isRecord(parsed) ? { ...parsed } : {}));
		}

		function offer(worker: ServiceWorker) {
			// With no controller this is the first install, which activates on its own.
			if (!navigator.serviceWorker.controller || waiting === worker) return;
			waiting = worker;
			set({ available: true });
			// Replaced by an even newer version before the user tapped Update: that one is offered.
			worker.addEventListener('statechange', () => {
				if (worker.state === 'redundant' && waiting === worker) {
					waiting = null;
					set({ available: false });
				}
			});
		}

		function track(worker: ServiceWorker) {
			const installed = () => {
				if (worker.state === 'installed') offer(worker);
			};
			worker.addEventListener('statechange', installed);
			installed();
		}

		/** A newer worker took over without this tab asking: another tab applied the update. */
		async function updatedElsewhere() {
			waiting = null;
			set({ available: false });
			if (document.visibilityState === 'hidden' && (await busyReasons()).length === 0) {
				markJustUpdated();
				location.reload();
			} else set({ reloadNeeded: true });
		}

		async function check() {
			// Fails offline or while the server is down; the next check tries again.
			await registration?.update().catch(() => {});
		}

		const update: AppUpdate = {
			get state() {
				return state;
			},
			subscribe(listener) {
				listeners.add(listener);
				listener(state);
				return () => void listeners.delete(listener);
			},
			askBeforeReload: options.askBeforeReload,
			check,
			busyReasons,
			markBusy(name, isBusy) {
				busy.set(name, isBusy);
				return () => {
					if (busy.get(name) === isBusy) busy.delete(name);
				};
			},
			apply() {
				if (!waiting) return;
				reloading = true;
				waiting.postMessage({ type: SKIP_WAITING });
			},
			reload() {
				markJustUpdated();
				location.reload();
			},
			carry(name, value) {
				carried.set(name, value);
				return () => {
					if (carried.get(name) === value) carried.delete(name);
				};
			},
			handover
		};
		app.decorate('update', update);

		app.addHook('onBoot', () => {
			set({ justUpdated: handover() !== null });
			if (!('serviceWorker' in navigator)) return;
			const container = navigator.serviceWorker;
			// The first install taking over an uncontrolled tab isn't an update.
			let controlled = !!container.controller;
			const onControllerChange = () => {
				if (reloading) {
					// Marked only now: a takeover that never happens mustn't say "updated" later.
					markJustUpdated();
					location.reload();
				} else if (controlled) void updatedElsewhere();
				controlled = true;
			};
			container.addEventListener('controllerchange', onControllerChange);
			stops.push(() => container.removeEventListener('controllerchange', onControllerChange));
			const onOnline = () => void check();
			const win = window;
			win.addEventListener('online', onOnline);
			stops.push(() => win.removeEventListener('online', onOnline));
			if (options.checkEveryMs > 0) {
				const timer = setInterval(() => void check(), options.checkEveryMs);
				stops.push(() => clearInterval(timer));
			}
			// Not awaited: without a registered worker (dev, blocked) this never settles.
			void container.ready.then((ready) => {
				if (closed) return;
				registration = ready;
				if (ready.waiting) offer(ready.waiting);
				if (ready.installing) track(ready.installing);
				const onUpdateFound = () => {
					if (ready.installing) track(ready.installing);
				};
				ready.addEventListener('updatefound', onUpdateFound);
				stops.push(() => ready.removeEventListener('updatefound', onUpdateFound));
				void check();
			});
		});
		// Coming back to the app is when a new version matters.
		app.addHook('onVisible', () => check());
		app.addHook('onClose', () => {
			closed = true;
			for (const stop of stops.splice(0)) stop();
		});
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
