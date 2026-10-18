/**
 * What `<App>` does: provides the app as context, boots it in the browser after mount, and
 * turns SvelteKit's navigation and page-visibility events into runtime hooks (RFC 0001,
 * decision 7).
 */
import { dev } from '$app/env';
import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
import { match } from '$app/paths';
import { savedDataInQuery, type App, type Route } from '@xcwds/core';
import { getContext, onMount, setContext } from 'svelte';
import { data } from 'virtual:xcwds/client';
import { askGuards, decide, normalizePath, routeOf, type GuardDecision } from './routes.js';
import { appLoaded, getApp, loadApp } from './runtime.svelte.js';
import { settings } from './settings.svelte.js';

const KEY = Symbol.for('xcwds.app');

/** Apps whose `onBoot` hooks have run (a remounted `<App>` doesn't boot them again). */
const booted = new WeakSet<App>();

/**
 * The app, for components and plugin code. Inside `<App>` it comes from context (so tests can
 * provide another one); elsewhere it is the page's app.
 */
export function useApp(): App {
	try {
		return getContext<App | undefined>(KEY) ?? getApp();
	} catch {
		// Called outside component initialisation.
		return getApp();
	}
}

/** The route hooks see: a path without the base path, or null outside the app. */
function route(url: URL): Route | null {
	return routeOf(url, data.base);
}

/** The next `popstate` event, or a moment later if none comes. */
function popstate(): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			removeEventListener('popstate', done);
			clearTimeout(timer);
			// Let SvelteKit's own popstate handling finish first.
			setTimeout(resolve);
		};
		const timer = setTimeout(done, 500);
		addEventListener('popstate', done);
	});
}

/** A URL as navigations compare it: no hash, and no trailing slash. */
function key(url: URL): string {
	return url.origin + normalizePath(url.pathname) + url.search;
}

/** Whether two URLs are the same page and query (a hash change doesn't count as leaving). */
function sameDocument(a: Location | URL, b: URL): boolean {
	return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
}

/**
 * In development, warns when a page's query string carries saved data (#22): queries reach the
 * server on every request, so user data belongs in the fragment (`#url=...`).
 */
function checkQuery(app: App, url: URL) {
	if (!dev || !url.search) return;
	const saved = app.storage
		.groups()
		.flatMap((g) => g.entries)
		.map((e) => app.storage.read(e));
	const names = savedDataInQuery(url, saved);
	if (names.length)
		app.log.warn(
			`The query parameter${names.length > 1 ? 's' : ''} ${names.join(', ')} of ${url.pathname} carr${names.length > 1 ? 'y' : 'ies'} saved data, which reaches the server with every request. Put it in the fragment (#...) instead.`
		);
}

/** What a navigation the app starts carries to `beforeNavigate` (see `next` in `startApp`). */
type Carried = { href: string; allowed: boolean; redirects: number; replace: boolean };

/** Sets up the app for `<App>`. Call during component initialisation. */
export function startApp(): void {
	const app = getApp();
	setContext(KEY, app);
	/** The booted app (null if it failed), once `<App>` has mounted. */
	let settle!: (app: App | null) => void;
	const ready = new Promise<App | null>((resolve) => (settle = resolve));
	let active = true;
	/** Counts guarded navigations: a hook result for an older one is dropped. */
	let token = 0;
	/**
	 * What the navigation this code starts next carries: the URL of one the hooks already
	 * allowed (so it isn't checked twice) and how many redirects led to it. Read and cleared by
	 * the next `beforeNavigate`, whatever it is.
	 */
	let next: Carried | null = null;

	/**
	 * Navigates to `url` (with the base path), carrying `carried` to the navigation it starts.
	 * SvelteKit's `goto` refuses paths it has no route for, so those are loaded instead (`404.html`
	 * boots the app), once the guards a link to them would have run allow it. Registered routes
	 * are pages (they are prerendered), so they go straight to `goto`.
	 */
	async function navigate(url: URL, carried: Carried) {
		const to = route(url);
		if ((to && app.routes.get(to.path)) || (await match(url))) {
			next = carried;
			// The URL has the base path.
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			return void goto(url, { replace: carried.replace });
		}
		const load = () => (carried.replace ? location.replace(url) : location.assign(url));
		if (carried.allowed || !to) return load();
		const current = ++token;
		const answer = await askGuards(app, to, route(new URL(location.href)));
		if (!active || current !== token) return;
		const decision = decide(answer, { target: url, base: data.base, redirects: carried.redirects });
		if (decision.action === 'allow') return load();
		follow(decision, carried.replace);
	}

	/** Navigates to a guard's redirect, whose own hooks then run (or reports a loop). */
	function follow(decision: GuardDecision, replace = false) {
		if (decision.action === 'stop') return void app.reportError(decision.error);
		if (decision.action !== 'redirect') return;
		const { url, redirects } = decision;
		// The whole chain replaces or pushes like its first hop: one entry at most.
		void navigate(url, { href: key(url), allowed: false, redirects, replace });
	}

	beforeNavigate((nav) => {
		// What this code carried over applies only to the navigation it started.
		const carried = next && nav.to && next.href === key(nav.to.url) ? next : null;
		next = null;
		// Links to app paths SvelteKit has no route for unload the page (`404.html` then boots
		// the app), but they are still the app's navigations, so they are guarded too.
		if (!nav.to || nav.type === 'leave' || !appLoaded()) return;
		const target = nav.to.url;
		if (target.origin !== location.origin) return;
		if (carried?.allowed) return;
		const to = route(target);
		if (!to) return;
		const redirects = carried?.redirects ?? 0;
		/** Whether this navigation is a hop of a chain that replaces the current entry. */
		const replace = carried?.replace ?? false;
		const from = nav.from ? route(nav.from.url) : null;
		const current = ++token;
		const result = askGuards(app, to, from);
		const sync = !(result instanceof Promise);
		// Every hook answered synchronously and lets it go ahead: nothing to do.
		if (sync && result !== false && typeof result !== 'string') return;
		nav.cancel();
		// SvelteKit undoes a cancelled back/forward navigation with history.go(-delta). Anything
		// that changes history must wait for that, or the browser drops it.
		const delta = nav.type === 'popstate' ? (nav.delta ?? 0) : 0;
		const reverted = delta ? popstate() : Promise.resolve();
		void Promise.all([result, reverted]).then(([answer]) => {
			if (!active || current !== token) return;
			const decision = decide(answer, { target, base: data.base, redirects });
			if (decision.action === 'cancel') return;
			if (decision.action !== 'allow') return follow(decision, replace);
			// An async hook held it and allows it: repeat it, marked so it isn't checked again.
			const marker = { href: key(target), allowed: true, redirects, replace };
			// Should the repeat never reach beforeNavigate, the mark mustn't let a later visit skip
			// the guards.
			setTimeout(() => {
				if (next === marker) next = null;
			}, 1000);
			if (delta) {
				next = marker;
				history.go(delta);
			}
			// `goto` can't know the original link's options (e.g. `data-sveltekit-replacestate`).
			else void navigate(target, marker);
		});
	});

	afterNavigate((nav) => {
		const to = nav.to && route(nav.to.url);
		if (!to) return;
		const url = nav.to!.url;
		void ready.then((a) => {
			if (a) checkQuery(a, url);
			return a?.hooks.run('afterNavigate', [to], { path: to.path });
		});
	});

	onMount(() => {
		const stops: (() => void)[] = [];
		// The first page was loaded, not navigated to: its guards run once the app has booted.
		// Captured now: by then the user may have navigated, and the redirect is only for this.
		const initial = new URL(location.href);
		const initialToken = token;
		void loadApp()
			.then(async (loaded) => {
				if (!active) return null;
				stops.push(settings.attach(loaded), loaded.storage.startSync(window));
				if (!booted.has(loaded)) {
					booted.add(loaded);
					await loaded.hooks.run('onBoot', []);
				}
				await loaded.ready();
				// A redirect replaces the first page in history; `false` can't take back a page that is
				// already showing. Either is dropped once the user (or the page itself, on load) has
				// navigated elsewhere, and then the guards don't hear of the first page at all: it isn't
				// where the app is going any more (#219).
				const first = route(initial);
				const still = () => active && token === initialToken && sameDocument(location, initial);
				if (first && still()) {
					const answer = await askGuards(loaded, first, null);
					const decision = decide(answer, {
						target: initial,
						base: data.base,
						redirects: 0,
						first: true
					});
					if (still()) follow(decision, true);
				}
				return loaded;
			})
			.catch((error: unknown) => {
				// A plugin failed to load: the page still works, without plugins.
				console.error('[xcwds]', error);
				return null;
			})
			.then((loaded) => {
				// Hydrated and booted: input from now on reaches the app, and plugins follow the
				// browser's events (`gotoHydrated` in @xcwds/testing waits for this).
				if (active) document.documentElement.dataset.hydrated = '';
				settle(loaded);
			});
		const onVisibility = () =>
			void ready.then((a) =>
				a?.hooks.run(document.visibilityState === 'hidden' ? 'onHidden' : 'onVisible', [])
			);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			active = false;
			document.removeEventListener('visibilitychange', onVisibility);
			for (const stop of stops) stop();
		};
	});
}
