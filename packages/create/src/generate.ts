/**
 * The files of a new app: a SvelteKit project wired to @xcwds (RFC 0001 decisions 1-4), with the
 * thin route files each picked plugin needs, tests and a GitHub Pages deploy workflow.
 */
import { CATALOG, withRequirements, type AppPlan, type PluginId } from './catalog.js';
import { THIRD_PARTY_VERSIONS, XCWDS_VERSIONS } from './versions.js';

export type PackageManager = 'pnpm' | 'npm';

export type GenerateOptions = {
	name: string;
	tagline?: string;
	/** The icon's SVG source; a neutral default when missing. */
	icon?: string;
	/** Plugin ids; their requirements are added. */
	plugins: readonly string[];
	packageManager?: PackageManager;
	/** `pnpm@10.x`, for package.json's `packageManager`. */
	packageManagerVersion?: string;
	/**
	 * Depend on the @xcwds packages with `workspace:*`, for an app generated inside this
	 * monorepo (its CI tests the starter that way, before anything is on npm).
	 */
	workspace?: boolean;
};

/** A plain, neutral icon: no text, nothing that says what the app holds. */
export const DEFAULT_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#334155"/><circle cx="32" cy="32" r="13" fill="none" stroke="#f8fafc" stroke-width="6"/></svg>\n';

/** Comment on the files `xcwds add` rewrites. */
export const MANAGED = 'Managed by `xcwds add`';

/** A package name from the app's name: `My Tools!` → `my-tools`. */
export function slug(name: string): string {
	return (
		name
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'xcwds-app'
	);
}

/** A string literal as prettier writes it: single quotes, unless the text has more of them. */
export function quote(s: string): string {
	const singles = s.split("'").length - 1;
	const doubles = s.split('"').length - 1;
	const q = singles > doubles ? '"' : "'";
	return q + s.replace(/\\/g, '\\\\').replaceAll(q, `\\${q}`) + q;
}

/** The @xcwds packages an app with these plugins depends on. */
export function xcwdsDependencies(plugins: readonly PluginId[]): string[] {
	return ['@xcwds/core', '@xcwds/sveltekit', ...plugins.map((id) => CATALOG[id].package)];
}

function version(name: string, workspace: boolean): string {
	if (workspace) return 'workspace:*';
	const v = XCWDS_VERSIONS[name];
	if (!v) throw new Error(`No version for ${name}.`);
	return `^${v}`;
}

function thirdParty(names: string[]): Record<string, string> {
	return Object.fromEntries(
		names.map((name) => {
			const v = THIRD_PARTY_VERSIONS[name];
			if (!v) throw new Error(`No version for ${name}.`);
			return [name, v];
		})
	);
}

const sortKeys = (o: Record<string, string>) =>
	Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

function packageJson(plan: AppPlan, options: GenerateOptions): string {
	const workspace = options.workspace ?? false;
	const pm = options.packageManager ?? 'pnpm';
	const run = pm === 'pnpm' ? 'pnpm' : 'npm run';
	const pkg: Record<string, unknown> = {
		name: slug(plan.name),
		version: '0.0.1',
		private: true,
		type: 'module',
		scripts: {
			// Writes .svelte-kit/tsconfig.json, which tsconfig.json extends, on install.
			prepare: "svelte-kit sync || echo ''",
			dev: 'vite dev',
			build: 'vite build',
			preview: 'vite preview',
			check: 'svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --fail-on-warnings',
			lint: 'prettier --check . && eslint .',
			format: 'prettier --write .',
			'test:unit': 'vitest',
			'test:e2e': 'vite build && playwright test',
			test: `vitest --run && ${run} test:e2e`
		},
		dependencies: sortKeys(
			Object.fromEntries(xcwdsDependencies(plan.plugins).map((n) => [n, version(n, workspace)]))
		),
		devDependencies: sortKeys({
			...thirdParty([
				'@eslint/compat',
				'@eslint/js',
				'@playwright/test',
				'@resvg/resvg-js',
				'@sveltejs/kit',
				'@sveltejs/vite-plugin-svelte',
				'@tailwindcss/vite',
				'@types/node',
				'eslint',
				'eslint-config-prettier',
				'eslint-plugin-svelte',
				'globals',
				'prettier',
				'prettier-plugin-svelte',
				'svelte',
				'svelte-check',
				'tailwindcss',
				'typescript',
				'typescript-eslint',
				'vite',
				'vitest'
			]),
			'@xcwds/create': version('@xcwds/create', workspace),
			'@xcwds/testing': version('@xcwds/testing', workspace)
		})
	};
	if (pm === 'pnpm') {
		if (options.packageManagerVersion) pkg.packageManager = options.packageManagerVersion;
		// pnpm 10 only runs the install scripts you allow; Vite needs esbuild's.
		pkg.pnpm = { onlyBuiltDependencies: ['esbuild'] };
	}
	return `${JSON.stringify(pkg, null, '\t')}\n`;
}

/** The shell's sections: Home, each picked plugin's page, and Settings last. */
export function sections(plugins: readonly PluginId[]): string {
	const list = [
		{ path: '/', label: 'Home', emoji: '🏠' },
		...plugins.flatMap((id) => (CATALOG[id].section ? [CATALOG[id].section] : []))
	].sort((a, b) => Number(a.path === '/settings') - Number(b.path === '/settings'));
	return list.map((s) => `\t${sectionItem(s.path, s.label, s.emoji)}`).join(',\n');
}

export const sectionItem = (path: string, label: string, emoji: string) =>
	`{ path: ${quote(path)}, label: ${quote(label)}, emoji: ${quote(emoji)} }`;

/** Indents every line of `text` after the first. */
export const indent = (text: string, prefix: string) => text.replace(/\n/g, `\n${prefix}`);

/** How a plugin appears in `plugins: [...]`, indented for it. */
export function pluginCall(id: PluginId, prefix = '\t\t'): string {
	return prefix + indent(CATALOG[id].call, prefix);
}

export function pluginImport(id: PluginId): string {
	return `import ${id} from '${CATALOG[id].package}';`;
}

/** Whether a line passes Prettier's 100 columns (it counts a tab as 2). */
const tooLong = (line: string) => line.length + line.match(/^\t*/)![0].length > 100;

/**
 * `key: value,` at `depth` tabs as Prettier writes it: a value that doesn't fit goes on its own
 * line, unless the key is shorter than 5 characters.
 */
export function property(key: string, value: string, depth: number): string {
	const tabs = '\t'.repeat(depth);
	const line = `${tabs}${key}: ${value},`;
	return tooLong(line) && key.length >= 5 ? `${tabs}${key}:\n${tabs}\t${value},` : line;
}

/** `const name = value;` as Prettier writes it: a value that doesn't fit goes on its own line. */
export function constant(name: string, value: string): string {
	const line = `const ${name} = ${value};`;
	return tooLong(line) ? `const ${name} =\n\t${value};` : line;
}

function config(plan: AppPlan): string {
	const imports = [
		"import { defineConfig } from '@xcwds/core';",
		...plan.plugins.map(pluginImport),
		...plan.plugins.flatMap((id) => CATALOG[id].configImports ?? [])
	];
	const brand = [
		property('name', quote(plan.name), 2),
		...(plan.tagline ? [property('tagline', quote(plan.tagline), 2)] : []),
		"\t\ticon: 'icon.svg',",
		"\t\tthemeColor: { light: '#ffffff', dark: '#0f172a' }"
	];
	return `${imports.join('\n')}

/** The tab bar on phones, and header links or a sidebar on wider screens. */
const sections = [
${sections(plan.plugins)}
];

export default defineConfig({
	brand: {
${brand.join('\n')}
	},
	plugins: [
		// \`xcwds add <plugin>\` adds more (it also writes their pages and styles).
${plan.plugins.map((id) => pluginCall(id)).join(',\n')}
	]
});
`;
}

/** `src/xcwds.css`: each plugin's styles, after Tailwind. */
export function pluginCss(plugins: readonly PluginId[]): string {
	// The theme's dark variant first: the other stylesheets use it.
	const order = [...plugins].sort((a, b) => Number(b === 'theme') - Number(a === 'theme'));
	const lines = order.flatMap((id) => (CATALOG[id].css ? [`@import '${CATALOG[id].css}';`] : []));
	return `/* ${MANAGED} from the plugins in package.json: edits here are overwritten. */\n${lines.join('\n')}\n`;
}

/** `src/lib/Notices.svelte`: what plugins show in the shell's notice stack. */
export function noticesComponent(plugins: readonly PluginId[]): string {
	const notices = plugins.flatMap((id) => (CATALOG[id].notice ? [CATALOG[id].notice] : []));
	const head = `<!-- ${MANAGED} from the plugins in package.json: edits here are overwritten. -->\n`;
	if (!notices.length) return `${head}`;
	const imports = notices.map((n) => `\timport ${n.name} from '${n.from}';`).join('\n');
	return `${head}<script lang="ts">\n${imports}\n</script>\n\n${notices.map((n) => `<${n.name} />`).join('\n')}\n`;
}

const README = (plan: AppPlan, pm: PackageManager) => {
	const run = pm === 'pnpm' ? 'pnpm' : 'npm run';
	const exec = pm === 'pnpm' ? 'pnpm' : 'npx';
	return `# ${plan.name}

${plan.tagline ? `${plan.tagline}\n\n` : ''}An installable, offline-first PWA made with [@xcwds](https://github.com/xcwds/xcwds). It runs
entirely in the browser: what people save stays on their device.

\`\`\`sh
${run} dev          # http://localhost:5173
${run} build        # the static site, in build/
${run} check        # types
${run} lint         # prettier and eslint
${run} test:unit --run
${run} test:e2e     # builds, then runs Playwright (${exec} playwright install chromium first)
\`\`\`

## Where things are

- \`xcwds.config.ts\`: the app's name, icon and colours, and its plugins with their options.
- \`src/routes/\`: pages. Plugin pages are small files that render a component the plugin
  exports (\`src/routes/settings/+page.svelte\`).
- \`src/xcwds.css\` and \`src/lib/Notices.svelte\` are kept in sync with your plugins by
  \`xcwds add\`; put your own styles in \`src/app.css\`.

## Add a plugin

\`\`\`sh
${exec} xcwds add timers
\`\`\`

It installs \`@xcwds/plugin-timers\`, adds it to \`xcwds.config.ts\` and writes its pages.
\`${exec} xcwds add\` lists the plugins.${
		plan.plugins.includes('tools')
			? `

## Add a tool

Add an item to \`tools({ items })\` in \`xcwds.config.ts\` and a page at its path, like
\`src/routes/tools/dice/+page.svelte\`.`
			: ''
	}

## Deploy to GitHub Pages

Push to GitHub, then in the repository's Settings → Pages set Source to "GitHub Actions".
\`.github/workflows/deploy.yml\` tests every push and pull request, and deploys \`main\`. A
project site lives under \`/<repo>\`, so the workflow builds with \`BASE_PATH\` set; a
\`<user>.github.io\` repository is served from the root. With a custom domain the site is served
from the root too: set the repository variable \`CUSTOM_DOMAIN\` (Settings → Secrets and variables →
Actions → Variables) to the domain, and the workflow leaves \`BASE_PATH\` empty.
`;
};

const GITIGNORE = `node_modules
build
.svelte-kit
.xcwds
test-results
playwright-report
.DS_Store
.env
.env.*
!.env.example
vite.config.js.timestamp-*
vite.config.ts.timestamp-*
`;

const PRETTIERRC = `{
	"useTabs": true,
	"singleQuote": true,
	"trailingComma": "none",
	"printWidth": 100,
	"plugins": ["prettier-plugin-svelte"],
	"overrides": [{ "files": "*.svelte", "options": { "parser": "svelte" } }]
}
`;

const PRETTIERIGNORE = `package-lock.json
pnpm-lock.yaml
yarn.lock
bun.lock
`;

const ESLINT = `import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-eslint';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		// typescript-eslint recommends turning no-undef off for TypeScript projects.
		rules: { 'no-undef': 'off' }
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: { projectService: true, extraFileExtensions: ['.svelte'], parser: ts.parser }
		}
	}
);
`;

const TSCONFIG = `${JSON.stringify(
	{
		extends: './.svelte-kit/tsconfig.json',
		compilerOptions: {
			allowJs: true,
			checkJs: true,
			esModuleInterop: true,
			forceConsistentCasingInFileNames: true,
			resolveJsonModule: true,
			skipLibCheck: true,
			sourceMap: true,
			strict: true,
			moduleResolution: 'bundler'
		}
	},
	null,
	'\t'
)}\n`;

const SVELTE_CONFIG = `import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { withXcwds } from '@xcwds/sveltekit/config';

// A GitHub Pages project site is served under /<repo>: the deploy workflow sets BASE_PATH.
const base = /** @type {'' | \`/\${string}\`} */ (process.env.BASE_PATH ?? '');

/** @type {import('@sveltejs/kit').Config} */
export default await withXcwds({ preprocess: vitePreprocess(), kit: { paths: { base } } });
`;

const VITE_CONFIG = `import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { xcwds } from '@xcwds/sveltekit/vite';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [xcwds(), sveltekit(), tailwindcss()] });
`;

const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';

// Unit tests run in Node, without SvelteKit: src/**/*.test.ts.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } });
`;

const PLAYWRIGHT_CONFIG = `import { defineConfig } from '@playwright/test';
import { xcwdsPlaywright } from '@xcwds/testing/playwright';

// Service workers are blocked unless a test opts in with \`test.use({ serviceWorkers: 'allow' })\`;
// set CHROMIUM_PATH to use a Chromium you already have.
export default defineConfig(xcwdsPlaywright());
`;

const APP_HTML = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		%sveltekit.head%
		<!-- The pre-paint script goes after the head SvelteKit renders, so its CSP meta applies. -->
		%xcwds.head%
	</head>
	<body data-sveltekit-preload-data="hover">
		<div style="display: contents">%sveltekit.body%</div>
	</body>
</html>
`;

const APP_CSS = `@import 'tailwindcss';
@import './xcwds.css';

/* Your own styles go here. */
`;

const APP_D_TS = `// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {}
}

export {};
`;

const LAYOUT = `<script lang="ts">
	import Notices from '$lib/Notices.svelte';
	import Shell from '@xcwds/plugin-shell/Shell.svelte';
	import { App } from '@xcwds/sveltekit';
	import '../app.css';

	let { children } = $props();
</script>

<App>
	<Shell>
		{@render children()}
		{#snippet notices()}
			<Notices />
		{/snippet}
	</Shell>
</App>
`;

const HOME = (plan: AppPlan) => `<script lang="ts">
	import Home from '@xcwds/plugin-shell/Home.svelte';
	import { brand } from '@xcwds/sveltekit';
</script>

<Home>
	<p>Welcome to {brand.name}.</p>
	<p>Edit <code>src/routes/+page.svelte</code> to change this page.</p>${
		plan.plugins.includes('tools') ? '\n\t<p>Your tools are in the Tools tab.</p>' : ''
	}
</Home>
`;

const UNIT_TEST = `import { validateConfig } from '@xcwds/core';
import { expect, it } from 'vitest';
import config from '../xcwds.config.js';

// Unit tests run in Node. To test a plugin of your own, boot it with buildTestApp() from
// @xcwds/testing.
it('has a valid config', () => {
	expect(validateConfig(config)).toMatchObject({ ok: true });
});
`;

const E2E = (plan: AppPlan) => {
	const pages = [
		'/',
		...plan.plugins.flatMap((id) => (CATALOG[id].section ? [CATALOG[id].section.path] : [])),
		...(plan.plugins.includes('tools') ? ['/tools/dice'] : [])
	];
	return `import { expect, test } from '@playwright/test';
import {
	auditTapTargets,
	gotoHydrated,
	serveStatic,
	waitForServiceWorker,
	type StaticServer
} from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

// The build, served the way GitHub Pages serves it.
let server: StaticServer;
const url = (path: string) => server.url(path);
test.beforeAll(async () => {
	server = await serveStatic(fileURLToPath(new URL('../build', import.meta.url)));
});
test.afterAll(() => server.close());

${constant('NAME', quote(plan.name))}
const PAGES = [${pages.map(quote).join(', ')}];

test('every page opens, with tap targets big enough for a finger', async ({ page }) => {
	for (const path of PAGES) {
		await gotoHydrated(page, url(path));
		await expect(page.locator('h1')).toBeVisible();
		expect(await auditTapTargets(page)).toEqual([]);
	}
});

test('unknown pages show the error page', async ({ page }) => {
	await gotoHydrated(page, url('/no-such-page'));
	await expect(page.getByTestId('error-page')).toBeVisible();
});

test('the manifest makes it installable', async ({ request }) => {
	const manifest = await (await request.get(url('/manifest.webmanifest'))).json();
	expect(manifest).toMatchObject({ name: NAME, display: 'standalone', start_url: '/' });
	expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(
		expect.arrayContaining(['192x192', '512x512'])
	);
});

test.describe('with the service worker', () => {
	test.use({ serviceWorkers: 'allow' });

	test('it works offline, and never contacts another server', async ({ page, context }) => {
		const origin = new URL(url('/')).origin;
		const away: string[] = [];
		context.on('request', (r) => {
			if (!/^(data|blob):/.test(r.url()) && new URL(r.url()).origin !== origin) away.push(r.url());
		});
		await gotoHydrated(page, url('/'));
		await waitForServiceWorker(page);
		await context.setOffline(true);
		for (const path of PAGES) {
			await gotoHydrated(page, url(path));
			await expect(page.locator('h1')).toBeVisible();
		}
		await context.setOffline(false);
		expect(away).toEqual([]);
	});
});
`;
};

const workflow = (pm: PackageManager, pinned: boolean) => {
	const pnpm = pm === 'pnpm';
	const setup = [
		'      - uses: actions/checkout@v4',
		...(pnpm ? ['      - uses: pnpm/action-setup@v4'] : []),
		// Without \`packageManager\` in package.json, the action needs a version.
		...(pnpm && !pinned ? ['        with:', '          version: 10'] : []),
		'      - uses: actions/setup-node@v4',
		'        with:',
		'          node-version: 24',
		`          cache: ${pm}`,
		`      - run: ${pnpm ? 'pnpm install --frozen-lockfile' : 'npm ci'}`
	].join('\n');
	const run = pnpm ? 'pnpm' : 'npm run';
	const exec = pnpm ? 'pnpm exec' : 'npx';
	return `# Tests every push and pull request, and deploys main to GitHub Pages
# (Settings → Pages → Source: GitHub Actions).
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: deploy-\${{ github.ref }}
  # A newer push to a pull request replaces the older run; deployments always finish.
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
${setup}
      - run: ${run} check
      - run: ${run} lint
      - run: ${run} test:unit --run
      - run: ${exec} playwright install --with-deps chromium
      - run: ${run} test:e2e

  deploy:
    if: github.event_name != 'pull_request'
    needs: test
    runs-on: ubuntu-latest
    # Job permissions replace the workflow's: checkout still needs to read the repository.
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
${setup}
      - run: ${run} build
        env:
          # A project site is served under /<repo>; <user>.github.io and a site with a custom domain
          # (set the repository variable CUSTOM_DOMAIN, e.g. to app.example.com) from the root.
          BASE_PATH: \${{ vars.CUSTOM_DOMAIN == '' && github.event.repository.name != format('{0}.github.io', github.repository_owner) && format('/{0}', github.event.repository.name) || '' }}
      - uses: actions/upload-pages-artifact@v3
        with:
          path: build
      - id: deployment
        uses: actions/deploy-pages@v4
`;
};

/** Every file of a new app, by path relative to its root. */
export function appFiles(options: GenerateOptions): Map<string, string> {
	// One line each: they go into string literals and headings.
	const line = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
	const name = line(options.name);
	if (!name) throw new Error('The app needs a name.');
	const plan: AppPlan = {
		name,
		tagline: line(options.tagline),
		plugins: withRequirements(options.plugins)
	};
	const pm = options.packageManager ?? 'pnpm';
	const files = new Map<string, string>([
		['package.json', packageJson(plan, options)],
		['README.md', README(plan, pm)],
		['.gitignore', GITIGNORE],
		['.prettierrc', PRETTIERRC],
		['.prettierignore', PRETTIERIGNORE],
		['eslint.config.js', ESLINT],
		['tsconfig.json', TSCONFIG],
		['svelte.config.js', SVELTE_CONFIG],
		['vite.config.ts', VITE_CONFIG],
		['vitest.config.ts', VITEST_CONFIG],
		['playwright.config.ts', PLAYWRIGHT_CONFIG],
		['xcwds.config.ts', config(plan)],
		['icon.svg', options.icon ?? DEFAULT_ICON],
		['src/app.html', APP_HTML],
		['src/app.css', APP_CSS],
		['src/app.d.ts', APP_D_TS],
		['src/xcwds.css', pluginCss(plan.plugins)],
		[
			'src/hooks.client.ts',
			"// Loads the plugins before the page hydrates.\nexport { init } from '@xcwds/sveltekit/hooks';\n"
		],
		[
			'src/hooks.server.ts',
			"// Loads the plugins, and puts the pre-paint script and head tags in every prerendered page.\nexport { handle, init } from '@xcwds/sveltekit/hooks';\n"
		],
		[
			'src/service-worker.ts',
			"// Generated from xcwds.config.ts by @xcwds/sveltekit.\nimport '../.xcwds/worker.js';\n"
		],
		['src/lib/Notices.svelte', noticesComponent(plan.plugins)],
		['src/routes/+layout.svelte', LAYOUT],
		['src/routes/+layout.ts', 'export const prerender = true;\n'],
		['src/routes/+page.svelte', HOME(plan)],
		[
			'src/routes/+error.svelte',
			'<script lang="ts">\n\timport ErrorPage from \'@xcwds/plugin-shell/ErrorPage.svelte\';\n</script>\n\n<ErrorPage />\n'
		],
		['src/app.test.ts', UNIT_TEST],
		['e2e/app.test.ts', E2E(plan)],
		['.github/workflows/deploy.yml', workflow(pm, Boolean(options.packageManagerVersion))]
	]);
	for (const id of plan.plugins)
		for (const file of CATALOG[id].files?.(plan) ?? []) files.set(file.path, file.content);
	return files;
}
