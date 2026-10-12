/**
 * The site's pages: the guides in `docs/` and a reference page per package, from its README.
 * Read in Node only (the config and prerendering), from the repository this site lives in.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The repository's root, above wherever the build or the tests run. */
export const ROOT = (() => {
	let dir = process.cwd();
	while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
		const up = dirname(dir);
		if (up === dir)
			throw new Error('The docs site must be built inside the xcwds/xcwds repository.');
		dir = up;
	}
	return dir;
})();

export const REPOSITORY = 'https://github.com/xcwds/xcwds';

export type Page = {
	/** The site path, without the base path. */
	path: string;
	/** The Markdown file, relative to the repository. */
	file: string;
	title: string;
	emoji: string;
	/** The page's index: `/docs` or `/reference`. */
	parent: '/docs' | '/reference';
	/** One line for the index. */
	blurb: string;
};

const GUIDES: [slug: string, file: string, emoji: string, blurb: string][] = [
	['getting-started', 'docs/getting-started.md', '🚀', 'From nothing to an app on your phone.'],
	['concepts', 'docs/concepts.md', '💡', 'Plugins, hooks, decorators, saved data and updates.'],
	['plugin-guide', 'docs/plugin-guide.md', '🧩', 'Build, test and use a plugin of your own.'],
	['privacy', 'docs/privacy.md', '🔒', 'How the framework keeps apps from phoning home.'],
	['ecosystem', 'docs/ecosystem.md', '🌱', 'Every plugin, first-party and community.'],
	['architecture', 'docs/rfc/0001-architecture.md', '📐', 'The design decisions, and why.']
];

/** Reference pages, in the order the index lists them. */
export const PACKAGES = [
	'core',
	'sveltekit',
	'testing',
	'create',
	'plugin-shell',
	'plugin-theme',
	'plugin-offline',
	'plugin-update',
	'plugin-install',
	'plugin-settings',
	'plugin-tools',
	'plugin-timers',
	'plugin-share',
	'plugin-changelog',
	'plugin-lock'
];

const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

/** The first `# ` heading of a Markdown file. */
export function titleOf(markdown: string): string {
	const title = /^# (.+)$/m.exec(markdown)?.[1]?.trim();
	if (!title) throw new Error('A page needs a "# Title" line.');
	return title.replace(/`/g, '');
}

function packageJson(name: string): { name: string; description?: string } {
	return JSON.parse(read(`packages/${name}/package.json`));
}

let cache: Page[] | undefined;

export function pages(): Page[] {
	cache ??= [
		...GUIDES.map(([slug, file, emoji, blurb]): Page => ({
			path: `/docs/${slug}`,
			file,
			title: titleOf(read(file)).replace(/^RFC 0001: /, ''),
			emoji,
			parent: '/docs',
			blurb
		})),
		...PACKAGES.map((name): Page => {
			const pkg = packageJson(name);
			return {
				path: `/reference/${name}`,
				file: `packages/${name}/README.md`,
				title: pkg.name,
				emoji: name.startsWith('plugin-') ? '🧩' : '📦',
				parent: '/reference',
				blurb: pkg.description ?? ''
			};
		})
	];
	return cache;
}

export function page(path: string): Page | undefined {
	return pages().find((p) => p.path === path);
}

/** The Markdown of a page. */
export function source(page: Page): string {
	return read(page.file);
}

/** The site page for a repository path (a file or a package folder), if there is one. */
export function pageForFile(repoPath: string): Page | undefined {
	const path = repoPath.replace(/\/+$/, '');
	return pages().find(
		(p) => p.file === path || (p.parent === '/reference' && p.file === `${path}/README.md`)
	);
}

export const exists = (repoPath: string) => existsSync(join(ROOT, repoPath));
