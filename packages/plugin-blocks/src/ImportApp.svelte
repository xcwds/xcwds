<script lang="ts">
	/**
	 * The import page (#162): a design shared as a link (`#app=<data>`) or chosen as a file,
	 * shown as text with every block and field, and added only on Add app (with a new id, so it
	 * never replaces one of yours). Render it from the `<path>/import` route's file, inside
	 * `<main class="page-narrow">`:
	 *
	 * ```svelte
	 * <ImportApp />    <!-- src/routes/my-apps/import/+page.svelte -->
	 * ```
	 *
	 * The link's design is taken out of the address bar and history as soon as it's read.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import type {} from './client.js';
	import { FILE_EXTENSION, dataOf, decodeDesign, readDesignFile } from './design.js';
	import type { AppDefinition, Block, LogField, Repeat } from './format.js';
	import { go } from './navigate.js';
	import { button, card, field as input, muted, primary } from './ui.js';

	const app = useApp();
	const blocks = app.blocks;
	/** From `@xcwds/plugin-shell`, if the app has it. */
	const toast = (message: string) =>
		(app as { toast?: (message: string) => void }).toast?.(message);

	/** False until the fragment has been read, so the prerendered page matches. */
	let loaded = $state(false);
	let design = $state.raw<AppDefinition>();
	let error = $state('');
	let saveError = $state('');

	onMount(() => {
		const read = async () => {
			const data = dataOf(location.hash);
			if (data === undefined) return;
			// Don't leave the design in the address bar or history.
			history.replaceState(history.state, '', location.pathname);
			design = undefined;
			error = saveError = '';
			const parsed = await decodeDesign(data);
			if (parsed.ok) design = parsed.value;
			else error = parsed.error;
		};
		void read().finally(() => (loaded = true));
		const onHash = () => void read();
		addEventListener('hashchange', onHash);
		return () => removeEventListener('hashchange', onHash);
	});

	async function choose(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		e.currentTarget.value = '';
		if (!file) return;
		design = undefined;
		error = saveError = '';
		const parsed = readDesignFile(await file.text());
		if (parsed.ok) design = parsed.value;
		else error = parsed.error;
	}

	function add() {
		if (!blocks || !design) return;
		const saved = blocks.addFromTemplate(design);
		if (!saved.ok) {
			saveError = saved.error;
			return;
		}
		toast(`Added ${saved.app.name}.`);
		void go(blocks.pathOf(saved.app), true);
	}

	const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	function repeats(repeat: Repeat | undefined): string {
		if (!repeat) return "doesn't repeat";
		if (repeat.repeat === 'daily') return 'every day';
		if (repeat.repeat === 'every') return `every ${repeat.days} days`;
		const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => repeat.weekdays.includes(d));
		return order.map((d) => DAYS[d]).join(', ');
	}

	function fieldText(f: LogField): string {
		switch (f.type) {
			case 'number': {
				const range = [f.min, f.max].some((n) => n !== undefined)
					? `, ${f.min ?? '…'} to ${f.max ?? '…'}`
					: '';
				return `number${f.unit ? ` in ${f.unit}` : ''}${range}`;
			}
			case 'scale':
				return `rating from 1 to ${f.max}${f.low || f.high ? ` (${f.low ?? '1'} to ${f.high ?? f.max})` : ''}`;
			case 'choice':
				return `one of: ${f.options.map((o) => o.label).join(', ')}`;
			case 'yesno':
				return 'yes or no';
			case 'text':
				return 'text';
			case 'time':
				return 'time';
		}
	}

	function blockText(b: Block): string {
		switch (b.type) {
			case 'checklist':
				return `Checklist, ${b.items.length === 1 ? '1 item' : `${b.items.length} items`}`;
			case 'counter': {
				const reset = {
					never: 'never starts again',
					daily: 'starts again each day',
					weekly: 'starts again each week'
				}[b.reset];
				return `Counter${b.goal !== undefined ? `, goal ${b.goal}${b.unit ? ` ${b.unit}` : ''}` : b.unit ? ` in ${b.unit}` : ''}, ${reset}`;
			}
			case 'log':
				return `Log, ${b.fields.length === 1 ? '1 field' : `${b.fields.length} fields`}`;
			case 'notes':
				return 'Notes';
		}
	}
</script>

{#if !blocks}
	<p>This app has no <code>@xcwds/plugin-blocks</code>.</p>
{:else if loaded}
	<div class="flex flex-col gap-6" data-testid="import-app">
		{#if design}
			<p class="{card} text-sm" role="note">
				Someone shared this app with you. Check it's what you expect before you add it: it's how the
				app is built, with nothing saved in it.
			</p>
			<section
				class="flex flex-col gap-4"
				aria-labelledby="import-name"
				data-testid="import-preview"
			>
				<h2 id="import-name" class="flex items-center gap-3 text-xl font-semibold">
					<span aria-hidden="true">{design.emoji ?? '🧩'}</span>{design.name}
				</h2>
				{#if design.private}
					<p class={muted}>Private: locked with your passcode once it's added.</p>
				{/if}
				<ul class="flex flex-col gap-3">
					{#each design.blocks as b (b.id)}
						<li class="{card} flex flex-col gap-1">
							<span class="font-medium">{b.label}</span>
							<span class={muted}>{blockText(b)}</span>
							{#if b.type === 'checklist' && b.items.length}
								<ul class="mt-1 list-disc pl-5 text-sm">
									{#each b.items as item (item.id)}
										<li>{item.label} <span class={muted}>({repeats(item.repeat)})</span></li>
									{/each}
								</ul>
							{:else if b.type === 'log'}
								<ul class="mt-1 list-disc pl-5 text-sm">
									{#each b.fields as f (f.id)}
										<li>{f.label} <span class={muted}>({fieldText(f)})</span></li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
				{#if !design.blocks.length}
					<p class={muted}>It has no blocks.</p>
				{/if}
			</section>
			{#if saveError}
				<p class="text-sm text-red-700 dark:text-red-400" role="alert">{saveError}</p>
			{/if}
			<div class="flex flex-wrap gap-2">
				<button type="button" class={primary} onclick={add}>Add app</button>
				<button type="button" class={button} onclick={() => void go(blocks.path, true)}
					>Cancel</button
				>
			</div>
		{:else}
			{#if error}
				<p class="text-sm text-red-700 dark:text-red-400" role="alert" data-testid="import-error">
					{error}
				</p>
			{/if}
			<label class="flex flex-col gap-2" for="import-file">
				<span class="font-medium">Add an app from a file</span>
				<span class={muted}>A design someone saved with Share design ({FILE_EXTENSION}).</span>
				<input
					id="import-file"
					type="file"
					accept="{FILE_EXTENSION},.json,application/json"
					class={input}
					onchange={choose}
				/>
			</label>
		{/if}
	</div>
{/if}
