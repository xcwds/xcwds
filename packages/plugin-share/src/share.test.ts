import { createApp, definePlugin, type Collection } from '@xcwds/core';
import { buildTestApp, buildTestWorker, type Importer } from '@xcwds/testing';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import shellClient from '@xcwds/plugin-shell/client';
import client, { cleanInbox, readShared, takeFiles } from './client.js';
import shareFactory, { build } from './index.js';
import {
	INBOX_MAX_AGE,
	accepts,
	filesFromFragment,
	fromFragment,
	fromQuery,
	resolveOptions,
	toFragment,
	type InboxMeta
} from './options.js';
import { share, shareData } from './share.js';
import worker from './worker.js';

afterEach(() => void vi.unstubAllGlobals());
// The button needs SvelteKit's runtime; e2e tests cover it.
vi.mock('./ShareButton.svelte', () => ({ default: function ShareButton() {} }));
vi.mock('./FilesNote.svelte', () => ({ default: function FilesNote() {} }));

const files = { target: '/photos', allowColdStartRisk: true } as const;

const importer: Importer = async (id) => {
	const entries: Record<string, () => Promise<Record<string, unknown>>> = {
		'@xcwds/plugin-share': () => import('./index.js'),
		'@xcwds/plugin-share/client': () => import('./client.js'),
		'@xcwds/plugin-share/worker': () => import('./worker.js')
	};
	const load = entries[id];
	if (!load) throw Object.assign(new Error(id), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
	return load();
};

describe('options', () => {
	it('fills in defaults and refuses mistakes', async () => {
		expect(resolveOptions()).toEqual({ target: null, exclude: ['/settings'], files: null });
		expect(resolveOptions({ target: '/inbox', exclude: [] })).toEqual({
			target: '/inbox',
			exclude: [],
			files: null
		});
		expect(() => resolveOptions({ target: '/' })).toThrow(/`target`/);
		expect(() => resolveOptions({ target: '/inbox?x' })).toThrow(/`target`/);
		expect(() => resolveOptions({ exclude: 'settings' })).toThrow(/`exclude`/);
		expect(() => resolveOptions({ targte: '/x' })).toThrow(/unknown option `targte`/);
		await expect(
			buildTestApp({ plugins: [shareFactory({ target: 'inbox' })] }, { import: importer })
		).rejects.toThrow(/@xcwds\/plugin-share: `target`/);
	});
});

describe('the files option', () => {
	it('needs the cold-start risk accepted, a target and image types', () => {
		expect(resolveOptions({ files }).files).toEqual({ target: '/photos', accept: ['image/*'] });
		expect(
			resolveOptions({ files: { ...files, accept: ['image/jpeg', 'image/heic'] } }).files
		).toEqual({ target: '/photos', accept: ['image/jpeg', 'image/heic'] });
		expect(() => resolveOptions({ files: { target: '/photos' } })).toThrow(
			/`allowColdStartRisk: true`.*uploads the image/
		);
		expect(() => resolveOptions({ files: { ...files, allowColdStartRisk: 'yes' } })).toThrow(
			/allowColdStartRisk/
		);
		expect(() => resolveOptions({ files: { ...files, target: '/' } })).toThrow(/`files.target`/);
		expect(() => resolveOptions({ files: { ...files, accept: ['application/pdf'] } })).toThrow(
			/`files.accept`/
		);
		expect(() => resolveOptions({ files: { ...files, accept: [] } })).toThrow(/`files.accept`/);
		expect(() => resolveOptions({ files: { ...files, max: 3 } })).toThrow(/`files.max`/);
		expect(() => resolveOptions({ files: true })).toThrow(/`files` must be an object/);
	});

	it('accepts the listed types, any image for image/*', () => {
		expect(accepts(['image/*'], 'image/png')).toBe(true);
		expect(accepts(['image/*'], 'text/plain')).toBe(false);
		expect(accepts(['image/*'], '')).toBe(false);
		expect(accepts(['image/jpeg'], 'IMAGE/JPEG')).toBe(true);
		expect(accepts(['image/jpeg'], 'image/png')).toBe(false);
	});

	it('names shared files in the fragment, with or without text', () => {
		const fragment = toFragment({ joined: '' }, { ids: ['a', 'b'], skipped: 1 });
		expect(fragment).toBe('#shared.files=a%2Cb&shared.skipped=1&url=');
		expect(fromFragment(fragment)).toEqual({ joined: '', skipped: 1 });
		expect(filesFromFragment(fragment)).toEqual({ ids: ['a', 'b'], skipped: 1 });
		const withText = toFragment({ joined: 'Look', text: 'Look' }, { ids: ['a'], skipped: 0 });
		expect(fromFragment(withText)).toEqual({ joined: 'Look', text: 'Look' });
		expect(filesFromFragment(withText)).toEqual({ ids: ['a'], skipped: 0 });
		expect(filesFromFragment('#url=https://x.example/?shared.files=a')).toBeNull();
		expect(filesFromFragment(toFragment({ joined: 'x', text: 'x' }))).toBeNull();
		expect(fromFragment('#shared.text=&url=')).toBeNull();
	});
});

describe('shared content', () => {
	it('joins the fields, link first, and moves them to the fragment and back', () => {
		const shared = fromQuery(
			new URLSearchParams({ title: 'A page', text: 'Look https://x.example/?a=1 &b', url: '' })
		)!;
		expect(shared).toEqual({
			joined: 'Look https://x.example/?a=1 &b A page',
			text: 'Look https://x.example/?a=1 &b',
			title: 'A page'
		});
		expect(fromFragment(toFragment(shared))).toEqual(shared);
		expect(fromQuery(new URLSearchParams('q=1'))).toBeNull();
		expect(fromQuery(new URLSearchParams('url=%20'))).toBeNull();
	});

	it("reads the iPhone Shortcut's #url= and ignores other fragments", () => {
		expect(fromFragment('#url=https%3A%2F%2Fx.example%2F%3Fa%3D1')).toEqual({
			joined: 'https://x.example/?a=1'
		});
		// Decoded whole, like the app it came from: a raw & or + stays part of the link.
		expect(fromFragment('#url=https://x.example/?a=1&b=2+3')).toEqual({
			joined: 'https://x.example/?a=1&b=2+3'
		});
		expect(fromFragment('#url=https://x.example/%E0%A4%A')).toEqual({
			joined: 'https://x.example/%E0%A4%A'
		});
		expect(fromFragment('#section')).toBeNull();
		expect(fromFragment('#url=')).toBeNull();
		expect(fromFragment('')).toBeNull();
	});

	it('round-trips fields holding &, +, = and url=', () => {
		const shared = {
			joined: 'a&url=b+c https://x.example/?q=a+b&r=1',
			text: 'a&url=b+c',
			url: 'https://x.example/?q=a+b&r=1'
		};
		const fragment = toFragment(shared);
		expect(fragment.startsWith('#shared.url=')).toBe(true);
		expect(fromFragment(fragment)).toEqual(shared);
	});

	it('prefers the fragment, and falls back to the query', () => {
		expect(readShared(new URL('https://a.example/inbox?text=q#url=f'))?.joined).toBe('f');
		expect(readShared(new URL('https://a.example/inbox?text=q'))?.joined).toBe('q');
		expect(readShared(new URL('https://a.example/inbox'))).toBeNull();
	});
});

describe('the Share button', () => {
	const at = (path: string, base = '') =>
		shareData(path, {
			origin: 'https://a.example',
			base,
			title: path === '/' ? undefined : 'Timer',
			appName: 'My app',
			tagline: 'Everyday tools.',
			exclude: ['/settings', '/private']
		});

	it('shares the origin, base path and path only', () => {
		expect(at('/')).toEqual({
			title: 'My app',
			text: 'My app: Everyday tools.',
			url: 'https://a.example/'
		});
		expect(at('/utils/timer/', '/sub')).toEqual({
			title: 'Timer',
			text: 'Timer on My app',
			url: 'https://a.example/sub/utils/timer'
		});
		expect(at('/', '/sub')!.url).toBe('https://a.example/sub/');
	});

	it('never shares excluded or private pages', () => {
		expect(at('/settings')).toBeNull();
		const options = {
			origin: 'https://a.example',
			base: '',
			title: 'Cycle',
			appName: 'A',
			tagline: ''
		};
		expect(shareData('/utils/cycle', { ...options, exclude: [], private: true })).toBeNull();
		expect(shareData('/utils/cycle', { ...options, exclude: [], private: false })).not.toBeNull();
		expect(at('/private/notes')).toBeNull();
		expect(at('/privately')).not.toBeNull();
	});

	it('shares, copies when it can’t, and treats closing the sheet as fine', async () => {
		const data = { title: 'T', text: 'T on A', url: 'https://a.example/t' };
		const copied: string[] = [];
		const clipboard = { writeText: async (s: string) => void copied.push(s) } as Clipboard;
		const shared: ShareData[] = [];
		type ShareData = typeof data;
		expect(
			await share(data, { share: async (d) => void shared.push(d as ShareData), clipboard })
		).toBe('shared');
		expect(shared).toEqual([data]);
		const abort = async () => {
			throw new DOMException('closed', 'AbortError');
		};
		expect(await share(data, { share: abort, clipboard })).toBe('cancelled');
		const refuse = async () => {
			throw new DOMException('no', 'NotAllowedError');
		};
		expect(await share(data, { share: refuse, clipboard })).toBe('copied');
		expect(await share(data, { share: undefined as never, clipboard })).toBe('copied');
		expect(copied).toEqual([data.url, data.url]);
		const broken = { writeText: () => Promise.reject(new Error('denied')) } as unknown as Clipboard;
		expect(await share(data, { share: undefined as never, clipboard: broken })).toBe('failed');
	});

	it("joins the shell's header once the app boots, and leaves on close", async () => {
		vi.stubGlobal('document', { documentElement: { setAttribute() {} } });
		const app = await buildTestApp({
			plugins: [
				[shellClient, {}],
				[client, {}]
			]
		});
		await vi.waitFor(() => expect(app.shell!.header.list()).toHaveLength(1));
		expect(app.shell!.header.list()[0]!.order).toBe(100);
		await app.close();
		expect(app.shell!.header.list()).toHaveLength(0);
	});

	it('says so with a toast when it copied', async () => {
		const toasts: string[] = [];
		vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } });
		const toaster = definePlugin(
			(a) => void a.decorate('toast', (message: string) => void toasts.push(message)),
			{ name: 'toaster', encapsulate: false }
		);
		const app = await buildTestApp({ plugins: [toaster, [client, {}]] });
		expect(await app.share!.share({ title: 'T', text: 'T', url: 'https://a.example/' })).toBe(
			'copied'
		);
		expect(toasts).toEqual(['Link copied.']);
		expect(app.shared).toBeUndefined();
	});
});

describe('the share target', () => {
	it('adds a GET share_target to the manifest, under the base path', async () => {
		const app = createApp();
		app.register(build, { target: '/inbox' });
		await app.ready();
		const manifest = await app.hooks.reduce('onManifest', { name: 'A', scope: '/sub/' });
		expect(manifest).toEqual({
			name: 'A',
			scope: '/sub/',
			share_target: {
				action: '/sub/inbox',
				method: 'GET',
				enctype: 'application/x-www-form-urlencoded',
				params: { url: 'url', text: 'text', title: 'title' }
			}
		});
		const none = createApp();
		none.register(build, {});
		await none.ready();
		expect(await none.hooks.reduce('onManifest', { name: 'A' })).toEqual({ name: 'A' });
	});

	it('moves a share from the query to the fragment before it leaves the device', async () => {
		const requests: string[] = [];
		const sw = await buildTestWorker(
			{ plugins: [[worker, { target: '/inbox' }]] },
			{
				base: '/sub',
				network: (request) => {
					requests.push(request.url);
					return new Response('page');
				}
			}
		);
		const response = (await sw.fetch('/inbox?title=T&text=secret%20https%3A%2F%2Fx.example', {
			mode: 'navigate'
		}))!;
		expect(response.status).toBe(303);
		const location = new URL(response.headers.get('location')!);
		expect(location.pathname + location.search).toBe('/sub/inbox');
		expect(fromFragment(location.hash)).toEqual({
			joined: 'secret https://x.example T',
			text: 'secret https://x.example',
			title: 'T'
		});
		expect(requests).toEqual([]);

		// Anything else goes on as usual.
		for (const path of ['/inbox', '/inbox?q=1', '/other?text=x'])
			expect((await sw.fetch(path, { mode: 'navigate' }))?.status, path).not.toBe(303);
		expect((await sw.fetch('/inbox?text=x'))?.status).not.toBe(303);
	});

	it('hands the page what was shared once, and clears it from the address', async () => {
		const events = new EventTarget();
		const location = {
			href: 'https://a.example/inbox?text=from%20the%20query',
			pathname: '/inbox'
		};
		const replaced: string[] = [];
		vi.stubGlobal('location', location);
		vi.stubGlobal('history', {
			state: null,
			replaceState: (_: unknown, __: string, url: string) => {
				replaced.push(url);
				location.href = `https://a.example${url}`;
			}
		});
		vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
		vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events));
		const app = await buildTestApp({ plugins: [[client, { target: '/inbox' }]] });
		const seen: string[] = [];
		const stop = app.shared!.listen((shared) => seen.push(shared.joined));
		expect(seen).toEqual(['from the query']);
		expect(replaced).toEqual(['/inbox']);

		// Safari reusing the tab: only the hash changes.
		location.href = 'https://a.example/inbox#url=again';
		events.dispatchEvent(new Event('hashchange'));
		expect(seen).toEqual(['from the query', 'again']);
		stop();
		location.href = 'https://a.example/inbox#url=later';
		events.dispatchEvent(new Event('hashchange'));
		expect(seen).toHaveLength(2);
	});

	it('makes the manifest share_target a POST with files', async () => {
		const app = createApp();
		app.register(build, { target: '/inbox', files: { ...files, accept: ['image/jpeg'] } });
		await app.ready();
		expect(await app.hooks.reduce('onManifest', { name: 'A', scope: '/sub/' })).toEqual({
			name: 'A',
			scope: '/sub/',
			share_target: {
				action: '/sub/photos',
				method: 'POST',
				enctype: 'multipart/form-data',
				params: {
					url: 'url',
					text: 'text',
					title: 'title',
					files: [{ name: 'files', accept: ['image/jpeg'] }]
				}
			}
		});
	});
});

describe('receiving shared images', () => {
	/** A multipart share as Android's share sheet sends it. */
	function sharePost(path: string, form: FormData) {
		return new Request(`http://localhost${path}`, { method: 'POST', body: form });
	}
	const png = (name = 'a.png', bytes = 'png') => new File([bytes], name, { type: 'image/png' });

	async function bootWorker(options: Record<string, unknown>, requests: string[] = []) {
		vi.stubGlobal('indexedDB', new IDBFactory());
		vi.stubGlobal('IDBKeyRange', IDBKeyRange);
		const sw = await buildTestWorker(
			{ plugins: [[worker, options]] },
			{
				base: '/sub',
				network: (request) => {
					requests.push(`${request.method} ${request.url}`);
					return new Response('page');
				}
			}
		);
		const inbox = sw.app.blobs
			.collections()
			.find((c) => c.key === 'app:share:inbox') as Collection<InboxMeta>;
		return { sw, inbox };
	}

	it('keeps the images in the inbox and redirects with their ids, never to the network', async () => {
		const requests: string[] = [];
		const { sw, inbox } = await bootWorker({ target: '/inbox', files }, requests);
		expect(inbox).toMatchObject({ sensitive: true, backup: false, label: 'Shared images' });
		const form = new FormData();
		form.append('text', 'secret note');
		form.append('files', png('cat.png'));
		form.append('files', new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }));
		form.append('files', new File([], 'empty.png', { type: 'image/png' }));
		const response = (await sw.fetch(sharePost('/sub/photos', form), { mode: 'navigate' }))!;
		expect(response.status).toBe(303);
		const location = new URL(response.headers.get('location')!);
		expect(location.pathname + location.search).toBe('/sub/photos');
		expect(fromFragment(location.hash)).toEqual({
			joined: 'secret note',
			text: 'secret note',
			skipped: 2
		});
		const { ids } = filesFromFragment(location.hash)!;
		expect(ids).toHaveLength(1);
		const saved = await sw.app.blobs.get(inbox, ids[0]!);
		expect(saved?.meta).toEqual({ name: 'cat.png' });
		expect(await saved?.blob.text()).toBe('png');
		expect(requests).toEqual([]);
	});

	it('sends links alone to the link target, and refuses nothing to the network', async () => {
		const requests: string[] = [];
		const { sw } = await bootWorker({ target: '/inbox', files }, requests);
		const form = new FormData();
		form.append('url', 'https://x.example/');
		const response = (await sw.fetch(sharePost('/sub/photos', form), { mode: 'navigate' }))!;
		const location = new URL(response.headers.get('location')!);
		expect(location.pathname).toBe('/sub/inbox');
		expect(fromFragment(location.hash)?.joined).toBe('https://x.example/');
		// Not a form: the page opens with nothing shared, and nothing reaches the server.
		const broken = new Request('http://localhost/sub/photos', {
			method: 'POST',
			body: 'x',
			headers: { 'content-type': 'multipart/form-data; boundary=nope' }
		});
		const empty = (await sw.fetch(broken, { mode: 'navigate' }))!;
		expect(empty.status).toBe(303);
		expect(empty.headers.get('location')).toBe('http://localhost/sub/inbox');
		expect(requests).toEqual([]);
		// Other POSTs aren't the worker's.
		await sw.fetch(sharePost('/sub/other', new FormData()), { mode: 'navigate' });
		expect(requests).toEqual(['POST http://localhost/sub/other']);
	});

	it('with files only, links go to files.target too', async () => {
		const { sw } = await bootWorker({ files });
		const form = new FormData();
		form.append('text', 'hi');
		const response = (await sw.fetch(sharePost('/sub/photos', form), { mode: 'navigate' }))!;
		expect(new URL(response.headers.get('location')!).pathname).toBe('/sub/photos');
	});

	it('hands the page the files and empties the inbox', async () => {
		const events = new EventTarget();
		const location = { href: 'https://a.example/photos', pathname: '/photos' };
		vi.stubGlobal('location', location);
		vi.stubGlobal('history', {
			state: null,
			replaceState: (_: unknown, __: string, url: string) =>
				void (location.href = `https://a.example${url}`)
		});
		vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
		vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events));
		const app = await buildTestApp({ plugins: [[client, { files }]] });
		expect(app.shared).toMatchObject({ target: '/photos', filesTarget: '/photos' });
		const inbox = app.blobs
			.collections()
			.find((c) => c.key === 'app:share:inbox') as Collection<InboxMeta>;
		const id = (await app.blobs.put(inbox, png('cat.png', 'meow'), { name: 'cat.png' })) as string;
		location.href = `https://a.example/photos${toFragment({ joined: '' }, { ids: [id, 'gone'], skipped: 1 })}`;
		const seen: { joined: string; files?: File[]; skipped?: number }[] = [];
		app.shared!.listen((shared) => seen.push(shared));
		await vi.waitFor(() => expect(seen).toHaveLength(1));
		expect(seen[0]).toMatchObject({ joined: '', skipped: 2 });
		expect(seen[0]!.files!.map((f) => [f.name, f.type])).toEqual([['cat.png', 'image/png']]);
		expect(await seen[0]!.files![0]!.text()).toBe('meow');
		expect(await app.blobs.list(inbox)).toEqual([]);
		expect(location.href).toBe('https://a.example/photos');
	});

	it('takes what it can read, and clears day-old files', async () => {
		const app = await buildTestApp({ plugins: [[client, { files }]] });
		const inbox = app.blobs
			.collections()
			.find((c) => c.key === 'app:share:inbox') as Collection<InboxMeta>;
		const id = (await app.blobs.put(inbox, png(), { name: 'a.png' })) as string;
		expect(await takeFiles(app.blobs, inbox, ['nope'])).toEqual({ files: [], missing: 1 });
		const now = Date.now();
		await cleanInbox(app.blobs, inbox, now);
		expect((await app.blobs.list(inbox)).map((i) => i.id)).toEqual([id]);
		await cleanInbox(app.blobs, inbox, now + INBOX_MAX_AGE + 1000);
		expect(await app.blobs.list(inbox)).toEqual([]);
	});
});
