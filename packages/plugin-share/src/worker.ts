/**
 * The service-worker entry: a share opens the target page with what was shared in its query
 * (`?url=…&text=…&title=…`). Before that request leaves the device, the worker answers it with
 * a 303 to the same page with the fields in the fragment, which browsers never send to a
 * server, so shared content never reaches one or its logs.
 *
 * With `files`, shares arrive as a multipart POST instead (#148). The worker answers that too:
 * it keeps each accepted image in the inbox (`app:share:inbox`) and redirects to `files.target`
 * with their ids and the text fields in the fragment. Nothing of it goes to the network.
 */
import { definePlugin, type App, type Collection } from '@xcwds/core';
import type {} from '@xcwds/sveltekit/worker';
import {
	CORE,
	FILES_FIELD,
	INBOX,
	NAME,
	accepts,
	fromQuery,
	resolveOptions,
	toFragment,
	type InboxMeta,
	type ResolvedShareOptions,
	type ShareOptions
} from './options.js';

/** Keeps a POSTed share's images in the inbox and redirects to the page that receives them. */
async function receive(
	app: App,
	inbox: Collection<InboxMeta>,
	{ target, files }: ResolvedShareOptions & { files: { target: string; accept: string[] } },
	request: Request,
	url: URL
): Promise<Response> {
	const base = app.worker?.base ?? '';
	let form: FormData | null = null;
	try {
		form = await request.formData();
	} catch {
		// Not a form after all: open the page with nothing shared.
	}
	const shared = form ? fromQuery(form) : null;
	const ids: string[] = [];
	let skipped = 0;
	for (const entry of form?.getAll(FILES_FIELD) ?? []) {
		if (typeof entry === 'string') continue;
		if (!entry.size || !accepts(files.accept, entry.type)) {
			skipped++;
			continue;
		}
		const id = await app.blobs.put(inbox, entry, { name: entry.name });
		if (id) ids.push(id);
		else skipped++;
	}
	// Links alone go to the link target, when there is one.
	const page = ids.length || skipped || !target ? files.target : target;
	const fragment =
		shared || ids.length || skipped ? toFragment(shared ?? { joined: '' }, { ids, skipped }) : '';
	return Response.redirect(`${url.origin}${base}${page}${fragment}`, 303);
}

export default definePlugin(
	(app, input: ShareOptions) => {
		const options = resolveOptions(input);
		const { target, files } = options;
		if (!target && !files) return;
		const inbox = files ? app.blobs.register(INBOX) : null;
		app.addHook('onFetch', (request, url) => {
			if (request.mode !== 'navigate') return;
			const base = app.worker?.base ?? '';
			const path = url.pathname.replace(/\/$/, '') || '/';
			if (files && inbox && request.method === 'POST' && path === base + files.target)
				return receive(app, inbox, { ...options, files }, request, url).catch((error: unknown) => {
					// Never let the share through to the server: open the page without it.
					app.log.warn("Couldn't receive a share:", error);
					return Response.redirect(`${url.origin}${base}${files.target}`, 303);
				});
			if (!target || request.method !== 'GET' || !url.search || path !== base + target) return;
			const shared = fromQuery(url.searchParams);
			if (!shared) return;
			return Response.redirect(`${url.origin}${base}${target}${toFragment(shared)}`, 303);
		});
	},
	{ name: NAME, core: CORE, network: false }
);
