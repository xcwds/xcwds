<script lang="ts">
	/**
	 * An app's blocks, each under its heading: what `<BlocksApp>` runs and the builder's Preview
	 * shows. `update(blockId)` saves one block's data.
	 */
	import type { ChecklistData } from '../checklist.js';
	import type { CounterData } from '../counter.js';
	import type { AppData, BlockData, NotesData } from '../data.js';
	import type { AppDefinition } from '../format.js';
	import type { LogData } from '../log.js';
	import { muted } from '../ui.js';
	import Checklist from './Checklist.svelte';
	import Counter from './Counter.svelte';
	import Log from './Log.svelte';
	import Notes from './Notes.svelte';
	import type { UpdateBlock } from './types.js';

	let {
		app,
		data,
		now,
		update
	}: {
		app: AppDefinition;
		data: AppData | undefined;
		now: number;
		update: <T extends BlockData>(blockId: string) => UpdateBlock<T>;
	} = $props();
</script>

{#each app.blocks as block (block.id)}
	{@const saved = data?.blocks[block.id]}
	<section class="flex flex-col gap-2" aria-labelledby="block-{block.id}">
		<h2 id="block-{block.id}" class="text-lg font-semibold">{block.label}</h2>
		{#if block.type === 'checklist'}
			<Checklist
				{block}
				{now}
				data={saved as ChecklistData | undefined}
				update={update<ChecklistData>(block.id)}
			/>
		{:else if block.type === 'counter'}
			<Counter
				{block}
				{now}
				data={saved as CounterData | undefined}
				update={update<CounterData>(block.id)}
			/>
		{:else if block.type === 'log'}
			<Log {block} {now} data={saved as LogData | undefined} update={update<LogData>(block.id)} />
		{:else}
			<Notes {block} data={saved as NotesData | undefined} update={update<NotesData>(block.id)} />
		{/if}
	</section>
{/each}
{#if !app.blocks.length}
	<p class={muted}>This app has no blocks yet.</p>
{/if}
