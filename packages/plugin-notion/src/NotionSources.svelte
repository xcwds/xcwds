<script lang="ts">
	/**
	 * The sources page (#107), at the plugin's `page`: the connection, "Add source", and the
	 * sources with when each was last downloaded and a Refresh button. Each source links to its
	 * copy at `<page>/view#<source id>`. Render it from that route's file, inside
	 * `<main class="page-narrow">`:
	 *
	 * ```svelte
	 * <NotionSources />   <!-- src/routes/notion/+page.svelte -->
	 * ```
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { parseId } from './api.js';
	import type { Source } from './client.js';
	import { viewHref } from './navigate.js';

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

	const field = 'min-h-11 rounded-xl border border-current/20 bg-transparent p-2';
	const button =
		'min-h-11 rounded-xl border border-current/20 px-4 font-medium hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10';

	let token = $state('');
	let connectNote = $state('');
	let connecting = $state(false);
	async function connect(event: SubmitEvent) {
		event.preventDefault();
		if (!notion || connecting) return;
		connecting = true;
		const result = await notion.connect(token);
		connecting = false;
		connectNote = result.ok ? `Connected as ${result.name || 'your integration'}.` : result.message;
		if (result.ok) token = '';
	}

	let confirmDisconnect = $state(false);
	function disconnect() {
		notion?.disconnect();
		confirmDisconnect = false;
		connectNote = '';
	}

	let kind = $state<Source['kind']>('page');
	let label = $state('');
	let link = $state('');
	let sortBy = $state<'created' | 'property'>('created');
	let property = $state('');
	let titleFilter = $state('');
	/** A database with several data sources: the ones to choose from, and the one chosen. */
	let choices = $state<{ id: string; name: string }[]>([]);
	let chosen = $state('');
	let adding = $state(false);
	let sourceNote = $state('');

	/** Clears the data source choice when what it was for changes. */
	$effect(() => {
		void link;
		void kind;
		choices = [];
		chosen = '';
	});

	async function add(event: SubmitEvent) {
		event.preventDefault();
		if (!notion || adding) return;
		const id = parseId(link);
		if (!label.trim()) return void (sourceNote = 'Give the source a label.');
		if (!id) return void (sourceNote = 'That isn’t a Notion link or id.');
		if (kind === 'database' && sortBy === 'property' && !property.trim())
			return void (sourceNote = 'Name the date property to sort by.');
		const base = { id: crypto.randomUUID(), label: label.trim() };
		let source: Source;
		if (kind === 'page') source = { ...base, kind, page: id };
		else if (kind === 'child') source = { ...base, kind, parent: id };
		else {
			let dataSource = chosen;
			if (!dataSource) {
				adding = true;
				const found = await notion.dataSources(id);
				adding = false;
				if (!found.ok) return void (sourceNote = found.message);
				if (found.dataSources.length === 0)
					return void (sourceNote = 'That database has no data sources to read.');
				if (found.dataSources.length > 1) {
					choices = found.dataSources;
					chosen = found.dataSources[0]!.id;
					sourceNote = 'This database has several data sources. Choose one, then Add again.';
					return;
				}
				dataSource = found.dataSources[0]!.id;
			}
			source = {
				...base,
				kind,
				dataSource,
				sort:
					sortBy === 'created' ? { by: 'created' } : { by: 'property', property: property.trim() },
				...(titleFilter.trim() ? { title: titleFilter.trim() } : {})
			};
		}
		if (!notion.saveSources((list) => [...list, source]))
			return void (sourceNote = 'The source couldn’t be saved.');
		sourceNote = '';
		label = link = property = titleFilter = '';
		void notion.refresh(source.id, { force: true });
	}

	let confirmRemove = $state<string>();
	function remove(id: string) {
		notion?.saveSources((list) => list.filter((s) => s.id !== id));
		confirmRemove = undefined;
	}

	const when = (ms: number) =>
		new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
</script>

{#if !notion}
	<p data-testid="notion-off">Notion isn’t set up in this app.</p>
{:else if view}
	<div class="flex flex-col gap-8">
		<section class="flex flex-col gap-3" aria-labelledby="notion-connection">
			<h2 id="notion-connection" class="text-lg font-semibold">Connection</h2>
			{#if view.connected}
				<p data-testid="notion-connected">Connected to Notion.</p>
				{#if confirmDisconnect}
					<p>Disconnecting removes the token and every saved copy. Your sources stay.</p>
					<div class="flex flex-wrap gap-2">
						<button type="button" class={button} onclick={disconnect}>Disconnect</button>
						<button type="button" class={button} onclick={() => (confirmDisconnect = false)}
							>Cancel</button
						>
					</div>
				{:else}
					<button
						type="button"
						class="{button} self-start"
						onclick={() => (confirmDisconnect = true)}>Disconnect…</button
					>
				{/if}
			{:else}
				<ol class="flex list-decimal flex-col gap-1 ps-6 text-sm">
					<li>
						Make an internal integration in Notion (Settings → Connections → Develop or manage
						integrations) with “Read content” only.
					</li>
					<li>
						Share each page or database you want here with it (the page’s ••• menu → Connections).
					</li>
					<li>Paste its token below. It stays on this device and only goes to Notion.</li>
				</ol>
				<form class="flex flex-col gap-2" onsubmit={connect}>
					<label class="flex flex-col gap-1">
						Integration token
						<input
							class={field}
							type="password"
							autocomplete="off"
							spellcheck="false"
							bind:value={token}
						/>
					</label>
					<button class="{button} self-start" disabled={connecting || !token.trim()}
						>{connecting ? 'Testing…' : 'Test connection'}</button
					>
				</form>
			{/if}
			<p data-testid="connect-note" role="status" class="empty:hidden">{connectNote}</p>
		</section>

		<section class="flex flex-col gap-3" aria-labelledby="notion-sources">
			<h2 id="notion-sources" class="text-lg font-semibold">Sources</h2>
			{#if view.sources.length}
				<ul class="flex flex-col gap-3" aria-label="Sources">
					{#each view.sources as { source, status, copy } (source.id)}
						<li
							class="flex flex-col gap-2 rounded-xl border border-current/20 p-3"
							data-testid="source"
						>
							<a
								class="flex min-h-11 items-center font-semibold underline underline-offset-2"
								href={viewHref(notion.page, source.id)}
								data-testid="source-label">{source.label}</a
							>
							<p class="text-sm opacity-70" aria-live="polite" data-testid="source-status">
								{#if status.downloading}Downloading…
								{:else if status.error}{status.message}
								{:else if status.empty}No page yet.
								{:else if copy}Downloaded {when(copy.fetchedAt)}.
								{:else}Not downloaded yet.{/if}
							</p>
							<div class="flex flex-wrap gap-2">
								<button
									type="button"
									class={button}
									disabled={status.downloading || !view.connected}
									onclick={() => notion.refresh(source.id, { force: true })}>Refresh</button
								>
								{#if confirmRemove === source.id}
									<button type="button" class={button} onclick={() => remove(source.id)}
										>Remove {source.label}</button
									>
									<button type="button" class={button} onclick={() => (confirmRemove = undefined)}
										>Cancel</button
									>
								{:else}
									<button type="button" class={button} onclick={() => (confirmRemove = source.id)}
										>Remove…</button
									>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<p data-testid="no-sources">No sources yet.</p>
			{/if}
		</section>

		<section class="flex flex-col gap-3" aria-labelledby="notion-add">
			<h2 id="notion-add" class="text-lg font-semibold">Add source</h2>
			<form class="flex flex-col gap-3" onsubmit={add}>
				<label class="flex flex-col gap-1">
					Kind
					<select class={field} bind:value={kind}>
						<option value="page">One page</option>
						<option value="database">Newest page in a database</option>
						<option value="child">Newest child page</option>
					</select>
				</label>
				<label class="flex flex-col gap-1">
					Label
					<input class={field} bind:value={label} maxlength="200" />
				</label>
				<label class="flex flex-col gap-1">
					{kind === 'page' ? 'Page' : kind === 'database' ? 'Database' : 'Parent page'} link or id
					<input class={field} bind:value={link} autocomplete="off" spellcheck="false" />
				</label>
				{#if kind === 'database'}
					{#if choices.length}
						<label class="flex flex-col gap-1">
							Data source
							<select class={field} bind:value={chosen}>
								{#each choices as choice (choice.id)}
									<option value={choice.id}>{choice.name || choice.id}</option>
								{/each}
							</select>
						</label>
					{/if}
					<label class="flex flex-col gap-1">
						Newest by
						<select class={field} bind:value={sortBy}>
							<option value="created">When it was created</option>
							<option value="property">A date property</option>
						</select>
					</label>
					{#if sortBy === 'property'}
						<label class="flex flex-col gap-1">
							Date property
							<input class={field} bind:value={property} maxlength="200" />
						</label>
					{/if}
					<label class="flex flex-col gap-1">
						Only pages whose title contains (optional)
						<input class={field} bind:value={titleFilter} maxlength="200" />
					</label>
				{/if}
				<button class="{button} self-start" disabled={adding}>{adding ? 'Checking…' : 'Add'}</button
				>
			</form>
			<p data-testid="source-note" role="status" class="empty:hidden">{sourceNote}</p>
		</section>
	</div>
{/if}
