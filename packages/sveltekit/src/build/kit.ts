/**
 * The SvelteKit config `xcwds()` passes to `sveltekit()`: a Vite plugin can't set the adapter or
 * CSP from its hooks, so they go in up front.
 */
import adapter from '@sveltejs/adapter-static';
import type { Adapter } from '@sveltejs/kit';
import type { Config } from '@sveltejs/kit/vite';
import { allowedOrigins, enforcePrivacy } from './privacy.js';
import type { BuildState } from './state.js';

type Csp = NonNullable<Config['csp']>;
type Directives = NonNullable<Csp['directives']>;
type Entry = NonNullable<NonNullable<Config['prerender']>['entries']>[number];

export type AdapterOptions = Parameters<typeof adapter>[0];

/**
 * A strict policy: same-origin only, plus the origins plugins declare and `privacy.allowOrigins`
 * lists (#22) for connections, images, fonts, media and styles. Scripts only ever come from the
 * app. Styles allow inline ones (Svelte transitions set them). The `<meta>` CSP of a static site
 * can't use `frame-ancestors` or reporting.
 */
function csp(user: Csp | undefined, origins: string[]): Csp {
	const web = origins.filter((o) => o.startsWith('https:'));
	const directives: Record<string, string[]> = {
		'default-src': ['self'],
		'script-src': ['self'],
		'style-src': ['self', 'unsafe-inline', ...web],
		'img-src': ['self', 'data:', 'blob:', ...web],
		'font-src': ['self', 'data:', ...web],
		'media-src': ['self', 'blob:', ...web],
		'connect-src': ['self', ...origins],
		'manifest-src': ['self'],
		'worker-src': ['self'],
		'object-src': ['none'],
		'base-uri': ['self'],
		'form-action': ['self']
	};
	const out: Record<string, unknown> = directives;
	for (const [name, value] of Object.entries(user?.directives ?? {})) {
		// Source lists are added to the defaults; other values (`upgrade-insecure-requests: true`,
		// `sandbox`) are kept as they are.
		out[name] = Array.isArray(value)
			? [...new Set([...(directives[name] ?? []), ...(value as string[])])]
			: value;
	}
	return { ...user, mode: user?.mode ?? 'hash', directives: out as Directives };
}

/**
 * Wraps the adapter so the built site is scanned for undeclared origins before it is written
 * (#22). The output SvelteKit hands every adapter holds the page bundle, the service worker,
 * static files and the prerendered pages.
 */
function scanned(adapter: Adapter, state: BuildState): Adapter {
	return {
		...adapter,
		async adapt(builder) {
			enforcePrivacy(
				[builder.getClientDirectory(), builder.getBuildDirectory('output/prerendered')],
				state.plugins,
				state.config.privacy.allowOrigins
			);
			return adapter.adapt(builder);
		}
	};
}

/**
 * Sets adapter-static with a `404.html` fallback (unknown URLs boot the app, on GitHub Pages and
 * offline), prerender entries for every registered route, and a hash-mode CSP that only allows
 * the origins plugins declare (#22); the build fails when its output contacts any other origin.
 */
export function kitConfig(config: Config, state: BuildState, options?: AdapterOptions): Config {
	const entries = [
		...(config.prerender?.entries ?? ['*']),
		...state.routes.map((r) => r.path),
		...state.prerender
	] as Entry[];
	return {
		...config,
		adapter: scanned(config.adapter ?? adapter({ fallback: '404.html', ...options }), state),
		prerender: { ...config.prerender, entries: [...new Set(entries)] },
		csp: csp(config.csp, [
			...allowedOrigins(state.plugins, state.config.privacy.allowOrigins).keys()
		])
	};
}
