import { error } from '@sveltejs/kit';
import { apiOf, type Api, type Member } from './api.js';
import { page, pages, source, type Page } from './pages.js';
import { render, renderInline, type Heading } from './render.js';

export type DocPage = {
	title: string;
	html: string;
	headings: Heading[];
	/** The file on GitHub, to edit it. */
	file: string;
	api?: Api;
	prev?: Pick<Page, 'path' | 'title'>;
	next?: Pick<Page, 'path' | 'title'>;
};

const withHtml = (members: Member[], file: string, base: string): Member[] =>
	members.map((m) => ({
		...m,
		doc: renderInline(m.doc, file, base),
		...(m.members ? { members: withHtml(m.members, file, base) } : {})
	}));

/**
 * The base path, as svelte.config.js sets it. Not `$app/paths`, which is relative while pages
 * prerender: the links end up in data that client-side navigation reuses on other pages.
 */
const base = process.env.BASE_PATH ?? '';

/** Everything a docs or reference page shows. Member docs come back as HTML. */
export function loadPage(path: string): DocPage {
	const found = page(path);
	if (!found) error(404, 'Not found');
	const { html, headings } = render(source(found), found.file, base);
	const siblings = pages().filter((p) => p.parent === found.parent);
	const at = siblings.indexOf(found);
	const link = (p: Page | undefined) => (p ? { path: p.path, title: p.title } : undefined);
	let api: Api | undefined;
	if (found.parent === '/reference' && found.path.startsWith('/reference/plugin-')) {
		const dir = found.file.replace(/\/README\.md$/, '');
		const raw = apiOf(dir);
		const file = `${dir}/src/index.ts`;
		api = {
			...(raw.options
				? {
						options: { name: raw.options.name, members: withHtml(raw.options.members, file, base) }
					}
				: {}),
			app: withHtml(raw.app, file, base),
			settings: withHtml(raw.settings, file, base),
			hooks: withHtml(raw.hooks, file, base)
		};
	}
	return {
		title: found.title,
		html,
		headings: [
			...headings.filter((h) => h.depth === 2),
			// Only when the page has an API section to show: a plugin without options, decorators,
			// settings or hooks (plugin-qr) has none.
			...(api &&
			(api.options?.members.length || api.app.length || api.settings.length || api.hooks.length)
				? [{ id: 'api', text: 'API', depth: 2 }]
				: [])
		],
		file: found.file,
		...(api ? { api } : {}),
		...(link(siblings[at - 1]) ? { prev: link(siblings[at - 1]) } : {}),
		...(link(siblings[at + 1]) ? { next: link(siblings[at + 1]) } : {})
	};
}

/** An index page's list. */
export function loadIndex(parent: Page['parent']) {
	return pages()
		.filter((p) => p.parent === parent)
		.map(({ path, title, emoji, blurb }) => ({ path, title, emoji, blurb }));
}
