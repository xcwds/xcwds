<script lang="ts">
	/**
	 * Runs one of your apps (#160): the page at `<path>/app#<id>`, or `<path>/private#<id>` with
	 * `private` for private apps. Render it from those routes' files, inside `<main class="page-narrow">`:
	 *
	 * ```svelte
	 * <BlocksApp />            <!-- src/routes/my-apps/app/+page.svelte -->
	 * <BlocksApp private />    <!-- src/routes/my-apps/private/+page.svelte -->
	 * ```
	 *
	 * The app's id is in the fragment, so it never reaches a server. An app opened on the wrong
	 * one of the two pages goes to the right one; an id that isn't on this device says so. The
	 * header shows the app's name (`app.shell.setTitle`; a private page's `<title>` stays the
	 * route's). While `app.lock` is locked, a private app shows nothing.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import Checklist from './blocks/Checklist.svelte';
	import Counter from './blocks/Counter.svelte';
	import Log from './blocks/Log.svelte';
	import Notes from './blocks/Notes.svelte';
	import type { ChecklistData } from './checklist.js';
	import type { CounterData } from './counter.js';
	import type { AppData, BlockData, NotesData } from './data.js';
	import type { AppDefinition } from './format.js';
	import type {} from './client.js';
	import type { LogData } from './log.js';
	import { go, href } from './navigate.js';
	import { button, muted } from './ui.js';

	let { private: personal = false }: { private?: boolean } = $props();

	const app = useApp();
	const blocks = app.blocks;
	type ShellLike = { setTitle(text: string | undefined): void };
	type LockLike = {
		readonly state: { readonly locked: boolean };
		subscribe(listener: (state: { readonly locked: boolean }) => void): () => void;
	};
	const lock = (app as { lock?: LockLike }).lock;

	/** Undefined until the page has read the fragment, so the prerendered page matches. */
	let loaded = $state(false);
	let definition = $state.raw<AppDefinition>();
	let data = $state.raw<AppData>();
	let locked = $state(false);
	/** "Now", for what's due today and counters' days: moves on each minute and when the page shows. */
	let now = $state(Date.now());

	function load() {
		if (!blocks) return;
		const id = decodeURIComponent(location.hash.slice(1));
		const found = id ? blocks.get(id) : undefined;
		if (found && found.private !== personal) {
			// On the wrong page: the private one locks, and the normal one would leave it in history.
			void go(blocks.pathOf(found), true);
			return;
		}
		definition = found;
		data = found ? blocks.data(found.id) : undefined;
		loaded = true;
		(app as { shell?: ShellLike }).shell?.setTitle(found?.name);
	}

	onMount(() => {
		// subscribe() calls back at once with the current state.
		const stopLock = personal ? lock?.subscribe((s) => (locked = s.locked)) : undefined;
		load();
		const tick = () => (now = Date.now());
		const timer = setInterval(tick, 60_000);
		document.addEventListener('visibilitychange', tick);
		addEventListener('hashchange', load);
		const stops = [blocks?.onChange(load), stopLock];
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', tick);
			removeEventListener('hashchange', load);
			for (const stop of stops) stop?.();
		};
	});

	/** Saves one block's data, starting from what's saved now. */
	function updater<T extends BlockData>(blockId: string) {
		return (change: (current: T | undefined) => T): boolean => {
			const app = definition;
			if (!blocks || !app) return false;
			const latest = blocks.data(app.id);
			const next = change(latest.blocks[blockId] as T | undefined);
			const saved = blocks.saveData(app.id, {
				...latest,
				blocks: { ...latest.blocks, [blockId]: next }
			});
			data = blocks.data(app.id);
			return saved;
		};
	}
</script>

{#if !blocks}
	<p>This app has no <code>@xcwds/plugin-blocks</code>.</p>
{:else if loaded && !locked}
	{#if !definition}
		<div class="flex flex-col items-start gap-3" data-testid="blocks-missing">
			<p>This app isn't on this device.</p>
			<a href={href(blocks.path)} class="{button} flex items-center">Your apps</a>
		</div>
	{:else}
		<div class="flex flex-col gap-6" data-testid="blocks-app" data-app-id={definition.id}>
			{#each definition.blocks as block (block.id)}
				{@const saved = data?.blocks[block.id]}
				<section class="flex flex-col gap-2" aria-labelledby="block-{block.id}">
					<h2 id="block-{block.id}" class="text-lg font-semibold">{block.label}</h2>
					{#if block.type === 'checklist'}
						<Checklist
							{block}
							{now}
							data={saved as ChecklistData | undefined}
							update={updater<ChecklistData>(block.id)}
						/>
					{:else if block.type === 'counter'}
						<Counter
							{block}
							{now}
							data={saved as CounterData | undefined}
							update={updater<CounterData>(block.id)}
						/>
					{:else if block.type === 'log'}
						<Log
							{block}
							{now}
							data={saved as LogData | undefined}
							update={updater<LogData>(block.id)}
						/>
					{:else}
						<Notes
							{block}
							data={saved as NotesData | undefined}
							update={updater<NotesData>(block.id)}
						/>
					{/if}
				</section>
			{/each}
			{#if !definition.blocks.length}
				<p class={muted}>This app has no blocks yet.</p>
			{/if}
		</div>
	{/if}
{/if}
