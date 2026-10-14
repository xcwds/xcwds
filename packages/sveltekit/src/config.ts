/**
 * `@xcwds/sveltekit/config`: wraps svelte.config.js, since a Vite plugin can't set SvelteKit's
 * adapter or CSP.
 *
 *   export default await withXcwds({ kit: { paths: { base: '/repo' } } });
 *
 * It reads `xcwds.config.*` (writing `.xcwds/`), and sets adapter-static with a `404.html`
 * fallback (unknown URLs boot the app, on GitHub Pages and offline), prerender entries for every
 * registered route, and a hash-mode CSP that only allows the origins plugins declare (#22); the
 * build fails when its output contacts any other origin. The root layout still needs `export const prerender = true`.
 */
import { resolve } from 'node:path';
import adapter from '@sveltejs/adapter-static';
import type { Adapter, Config } from '@sveltejs/kit';
import { OUT_DIR, TYPES_FILE, generate } from './build/generate.js';
import { allowedOrigins, enforcePrivacy } from './build/privacy.js';
import { remember, type BuildState } from './build/state.js';

type KitConfig = NonNullable<Config['kit']>;
type Csp = NonNullable<KitConfig['csp']>;
type Directives = NonNullable<Csp['directives']>;
type Entry = NonNullable<NonNullable<KitConfig['prerender']>['entries']>[number];

export type XcwdsKitOptions = {
	/** The app's root. Defaults to the working directory, where SvelteKit looks for its config. */
	root?: string;
	/** Options for adapter-static (ignored when `kit.adapter` is set). */
	adapter?: Parameters<typeof adapter>[0];
};

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

type TsConfigHook = NonNullable<NonNullable<KitConfig['typescript']>['config']>;

/**
 * Adds `.xcwds/types.d.ts` (the plugins' type references) to the tsconfig SvelteKit generates in
 * `.svelte-kit/`, then runs the app's own hook.
 */
function withTypes(own: TsConfigHook | undefined): TsConfigHook {
	return (config) => {
		const file = `../${OUT_DIR}/${TYPES_FILE}`;
		const include = Array.isArray(config.include) ? (config.include as unknown[]) : [];
		if (!include.includes(file)) config.include = [...include, file];
		return own ? own(config) : config;
	};
}

export async function withXcwds(
	svelteConfig: Config = {},
	options: XcwdsKitOptions = {}
): Promise<Config> {
	const kit: KitConfig = svelteConfig.kit ?? {};
	const state = await generate({
		root: resolve(options.root ?? process.cwd()),
		base: kit.paths?.base ?? '',
		assets: kit.files?.assets ?? 'static'
	});
	remember(state);
	const entries = [
		...(kit.prerender?.entries ?? ['*']),
		...state.routes.map((r) => r.path),
		...state.prerender
	] as Entry[];
	return {
		...svelteConfig,
		kit: {
			...kit,
			adapter: scanned(kit.adapter ?? adapter({ fallback: '404.html', ...options.adapter }), state),
			prerender: { ...kit.prerender, entries: [...new Set(entries)] },
			csp: csp(kit.csp, [
				...allowedOrigins(state.plugins, state.config.privacy.allowOrigins).keys()
			]),
			typescript: { ...kit.typescript, config: withTypes(kit.typescript?.config) }
		}
	};
}
