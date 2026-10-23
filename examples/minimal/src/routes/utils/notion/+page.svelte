<script lang="ts">
	// A bare page over `app.notion` (#106) until the plugin's own pages land (#107): connect,
	// add sources, download them and read the saved copies with `<NotionDocument>`.
	import NotionDocument from '@xcwds/plugin-notion/NotionDocument.svelte';
	import type { NotionDocument as Copy } from '@xcwds/plugin-notion/document';
	import { parseId } from '@xcwds/plugin-notion/api';
	import type { Source } from '@xcwds/plugin-notion/client';
	import { resolve } from '$app/paths';
	import { useApp } from '@xcwds/sveltekit';

	const app = useApp();
	const notion = app.notion;

	// Bumped on every change `app.notion` reports, so the reads below run again.
	let version = $state(0);
	$effect(() => notion?.onChange(() => version++));
	const view = $derived.by(() => {
		void version;
		if (!notion) return undefined;
		return {
			connected: notion.connected(),
			sources: notion.sources().map((source) => ({
				source,
				status: notion.status(source.id),
				copy: notion.copy(source.id)
			}))
		};
	});

	let token = $state('');
	let connectNote = $state('');
	let connecting = $state(false);
	async function connect(event: SubmitEvent) {
		event.preventDefault();
		if (!notion) return;
		connecting = true;
		const result = await notion.connect(token);
		connecting = false;
		connectNote = result.ok ? `Connected as ${result.name || 'your integration'}.` : result.message;
		if (result.ok) token = '';
	}

	let kind = $state<'page' | 'child' | 'database'>('page');
	let label = $state('');
	let link = $state('');
	let sourceNote = $state('');
	function add(event: SubmitEvent) {
		event.preventDefault();
		if (!notion) return;
		const id = parseId(link);
		if (!id || !label.trim()) {
			sourceNote = 'Give it a label and a Notion link or id.';
			return;
		}
		const base = { id: crypto.randomUUID(), label: label.trim() };
		const source: Source =
			kind === 'page'
				? { ...base, kind, page: id }
				: kind === 'child'
					? { ...base, kind, parent: id }
					: { ...base, kind, dataSource: id, sort: { by: 'created' } };
		if (!notion.saveSources((list) => [...list, source])) {
			sourceNote = 'The source couldn’t be saved.';
			return;
		}
		sourceNote = '';
		label = '';
		link = '';
		void notion.refresh(source.id, { force: true });
	}

	const remove = (id: string) => notion?.saveSources((list) => list.filter((s) => s.id !== id));

	const time = (copy: Copy) =>
		new Date(copy.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
</script>

<main class="page-narrow flex flex-col gap-6 pt-2 pb-6">
	{#if !view}
		<p data-testid="notion-off">This build has no Notion relay.</p>
	{:else}
		<section class="flex flex-col gap-2" aria-labelledby="connection">
			<h2 id="connection" class="text-lg font-semibold">Connection</h2>
			{#if view.connected}
				<div class="flex flex-wrap items-center gap-3">
					<p data-testid="notion-connected">Connected to Notion.</p>
					<button
						type="button"
						class="min-h-11 rounded-xl border px-3"
						onclick={() => {
							notion?.disconnect();
							connectNote = '';
						}}>Disconnect</button
					>
				</div>
			{:else}
				<form class="flex flex-col gap-2" onsubmit={connect}>
					<label class="flex flex-col gap-1">
						Integration token
						<input
							class="min-h-11 rounded-xl border p-2"
							type="password"
							autocomplete="off"
							bind:value={token}
						/>
					</label>
					<button
						class="min-h-11 self-start rounded-xl border px-3"
						disabled={connecting || !token.trim()}>Test connection</button
					>
				</form>
			{/if}
			{#if connectNote}<p data-testid="connect-note" role="status">{connectNote}</p>{/if}
		</section>

		<section class="flex flex-col gap-2" aria-labelledby="add">
			<h2 id="add" class="text-lg font-semibold">Add a source</h2>
			<form class="flex flex-col gap-2" onsubmit={add}>
				<label class="flex flex-col gap-1">
					Kind
					<select class="min-h-11 rounded-xl border p-2" bind:value={kind}>
						<option value="page">Page</option>
						<option value="child">Newest child page</option>
						<option value="database">Newest in a data source</option>
					</select>
				</label>
				<label class="flex flex-col gap-1">
					Label
					<input class="min-h-11 rounded-xl border p-2" bind:value={label} />
				</label>
				<label class="flex flex-col gap-1">
					Link or id
					<input class="min-h-11 rounded-xl border p-2" bind:value={link} />
				</label>
				<button class="min-h-11 self-start rounded-xl border px-3">Add</button>
			</form>
			{#if sourceNote}<p data-testid="source-note">{sourceNote}</p>{/if}
		</section>

		<ul class="flex flex-col gap-4" aria-label="Sources">
			{#each view.sources as { source, status, copy } (source.id)}
				<li class="flex flex-col gap-2 rounded-xl border p-3" data-testid="source">
					<div class="flex flex-wrap items-center gap-2">
						<a
							class="flex min-h-11 items-center font-semibold underline underline-offset-2"
							href="{resolve('/utils/notion/view')}#{encodeURIComponent(source.id)}"
							data-testid="source-label">{source.label}</a
						>
						<button
							type="button"
							class="min-h-11 rounded-xl border px-3"
							disabled={status.downloading}
							onclick={() => notion?.refresh(source.id, { force: true })}>Refresh</button
						>
						<button
							type="button"
							class="min-h-11 rounded-xl border px-3"
							onclick={() => remove(source.id)}>Remove</button
						>
					</div>
					<p data-testid="source-status">
						{#if status.downloading}Downloading…
						{:else if status.error}{status.message}
						{:else if status.empty}No page yet.
						{:else if copy}Downloaded {time(copy)}{copy.truncated ? ' (cut short)' : ''}.
						{:else}Not downloaded yet.{/if}
					</p>
					{#if copy}
						<div data-testid="copy"><NotionDocument document={copy} /></div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>
