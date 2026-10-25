<script lang="ts">
	/**
	 * One source's saved copy (#107): the page at `<page>/view#<source id>`. Render it from that
	 * route's file, inside `<main class="page-wide">`:
	 *
	 * ```svelte
	 * <NotionView />   <!-- src/routes/notion/view/+page.svelte -->
	 * ```
	 *
	 * The id is in the fragment, so it never reaches a server. Opening the page downloads the
	 * source again when its copy is older than the refresh setting; the saved copy shows meanwhile,
	 * offline, and when a download fails, with a note that says why.
	 *
	 * With the `writes` option (#109), the copy's to-dos can be ticked and a note added at its end
	 * (`<NotionChanges>`); both show at once, and the changes still waiting to be sent are listed.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import NotionChanges from './NotionChanges.svelte';
	import NotionDocument from './NotionDocument.svelte';
	import type {} from './client.js';
	import { fromToday } from './sources.js';

	const app = useApp();
	const notion = app.notion;

	/** Undefined until the page has read the fragment, so the prerendered page matches. */
	let id = $state<string>();
	let version = $state(0);
	/** Why the last tick wasn't kept; it belongs to the copy on show. */
	let checkError = $state('');

	$effect(() => {
		const read = () => {
			try {
				id = decodeURIComponent(location.hash.slice(1));
			} catch {
				id = '';
			}
			checkError = '';
		};
		read();
		addEventListener('hashchange', read);
		return () => removeEventListener('hashchange', read);
	});
	$effect(() => notion?.onChange(() => version++));

	const view = $derived.by(() => {
		void version;
		if (!notion || id === undefined) return undefined;
		const source = notion.sources().find((s) => s.id === id);
		if (!source) return { source: undefined };
		return {
			source,
			status: notion.status(source.id),
			copy: notion.copy(source.id),
			connected: notion.connected(),
			outbox: notion.writes ? notion.outbox().filter((item) => item.source === source.id) : [],
			conflicts: notion.conflicts().filter((conflict) => conflict.item.source === source.id),
			sending: notion.sending()
		};
	});

	/** Ticks or unticks a to-do of the copy on show; false puts the box back. */
	function check(block: string, checked: boolean) {
		const ok = !!id && !!notion?.change(id, { kind: 'check', block, checked });
		checkError = ok ? '' : 'That change couldn’t be saved on this device.';
		return ok;
	}

	// Opening the page brings a stale copy up to date (`refresh` does nothing for a fresh one).
	$effect(() => {
		if (id && notion?.connected() && notion.sources().some((s) => s.id === id))
			void notion.refresh(id);
	});

	const when = (ms: number) =>
		new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
	const day = (iso: string) => {
		const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
		const date = bare
			? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]))
			: new Date(iso);
		return Number.isNaN(date.getTime())
			? iso
			: date.toLocaleDateString([], { dateStyle: 'medium' });
	};
</script>

{#if !notion}
	<p data-testid="notion-view-off">Notion isn’t set up in this app.</p>
{:else if view && !view.source}
	<p data-testid="notion-view-missing">This Notion source isn’t on this device.</p>
{:else if view?.source}
	{@const { source, status, copy, connected, outbox, conflicts, sending } = view}
	<div class="flex flex-col gap-4" data-testid="notion-view">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-sm opacity-70" aria-live="polite" data-testid="notion-view-status">
				{#if status.downloading}Downloading…
				{:else if status.error}{status.message}
				{:else if status.empty}No page yet.
				{:else if copy}Downloaded {when(copy.fetchedAt)}.
				{:else if !connected}Connect to Notion to download this page.
				{:else}Not downloaded yet.{/if}
			</p>
			<button
				type="button"
				class="min-h-11 rounded-xl border border-current/20 px-4 font-medium hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
				disabled={status.downloading || !connected}
				onclick={() => notion.refresh(source.id, { force: true })}>Refresh</button
			>
		</div>
		{#if copy}
			{#if source.kind !== 'page' && !fromToday(copy.createdTime)}
				<p class="rounded-xl border border-current/20 p-3 text-sm" data-testid="notion-view-old">
					No newer page yet{copy.createdTime ? `: this one is from ${day(copy.createdTime)}` : ''}.
				</p>
			{/if}
			{#if notion.writes}
				<p data-testid="notion-check-error" role="status" class="empty:hidden">{checkError}</p>
			{/if}
			<NotionDocument
				document={copy}
				image={notion.image}
				check={notion.writes ? check : undefined}
			/>
		{/if}
		{#if notion.writes && (copy || outbox.length)}
			<NotionChanges
				{notion}
				source={source.id}
				blocks={copy?.blocks ?? []}
				hasCopy={!!copy}
				{outbox}
				{conflicts}
				{sending}
				{connected}
			/>
		{/if}
	</div>
{/if}
