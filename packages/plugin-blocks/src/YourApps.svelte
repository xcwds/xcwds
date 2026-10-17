<script lang="ts">
	/**
	 * Your apps (#160): the list, each one deletable with Undo, and Add from a template. Render
	 * it from the `<path>` route's file (default `/my-apps`), inside `<main class="page-wide">`:
	 *
	 * ```svelte
	 * <YourApps />
	 * ```
	 *
	 * Adding a template saves a copy with a new id and opens it.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import type {} from './client.js';
	import type { AppDefinition } from './format.js';
	import { go, href } from './navigate.js';
	import type { AppSummary, Removed } from './store.js';
	import { button, card, muted } from './ui.js';

	const app = useApp();
	const blocks = app.blocks;

	/** Undefined until listed, so the prerendered page matches the first render. */
	let list = $state.raw<AppSummary[]>();
	let error = $state('');
	/** The last deleted app, until Undo times out. */
	let undo = $state.raw<{ name: string; removed: Removed; timer: ReturnType<typeof setTimeout> }>();

	onMount(() => {
		if (!blocks) return;
		const load = () => (list = blocks.list());
		load();
		const stop = blocks.onChange(load);
		return () => {
			stop();
			if (undo) clearTimeout(undo.timer);
		};
	});

	function remove(summary: AppSummary) {
		if (!blocks) return;
		if (!confirm(`Delete "${summary.name}" and everything saved in it?`)) return;
		const removed = blocks.remove(summary.id);
		if (!removed.ok) return;
		if (undo) clearTimeout(undo.timer);
		undo = { name: summary.name, removed, timer: setTimeout(() => (undo = undefined), 8000) };
	}

	function restore() {
		if (!undo) return;
		clearTimeout(undo.timer);
		const { removed } = undo;
		undo = undefined;
		removed.restore();
	}

	function add(template: AppDefinition) {
		if (!blocks) return;
		const saved = blocks.addFromTemplate(template);
		if (!saved.ok) {
			error = saved.error;
			return;
		}
		error = '';
		void go(blocks.pathOf(saved.app));
	}

	const describe = (t: AppDefinition) => t.blocks.map((b) => b.label).join(', ');
</script>

{#if !blocks}
	<p>This app has no <code>@xcwds/plugin-blocks</code>.</p>
{:else}
	<div class="flex flex-col gap-6">
		<section class="flex flex-col gap-3" aria-labelledby="your-apps-heading">
			<h2 id="your-apps-heading" class="sr-only">Your apps</h2>
			{#if list && !list.length}
				<p class={muted} data-testid="your-apps-empty">
					No apps yet. Add one from a template below.
				</p>
			{:else if list}
				<ul class="grid gap-2 md:grid-cols-2 lg:grid-cols-3" data-testid="your-apps">
					{#each list as summary (summary.id)}
						<li class="flex items-stretch gap-2">
							<a
								href={href(summary.path)}
								class="flex flex-1 items-center gap-3 rounded-xl bg-(--xcwds-shell-card) px-4 py-3 hover:bg-(--xcwds-shell-hover-bg)"
							>
								<span aria-hidden="true" class="text-2xl">{summary.emoji ?? '🧩'}</span>
								<span class="flex flex-col">
									<span class="font-medium">{summary.name}</span>
									{#if summary.private}<span class={muted}>Private</span>{/if}
								</span>
							</a>
							<button
								type="button"
								class={button}
								aria-label="Delete {summary.name}"
								onclick={() => remove(summary)}>Delete</button
							>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="flex min-h-11 items-center gap-3 text-sm" aria-live="polite">
				{#if undo}
					Deleted {undo.name}.
					<button type="button" class={button} onclick={restore}>Undo</button>
				{/if}
			</p>
		</section>

		{#if blocks.templates.length}
			<section class="flex flex-col gap-3" aria-labelledby="templates-heading">
				<h2 id="templates-heading" class="text-lg font-semibold">Add from a template</h2>
				<ul class="grid gap-2 md:grid-cols-2 lg:grid-cols-3" data-testid="templates">
					{#each blocks.templates as template (template.id)}
						<li>
							<button
								type="button"
								class="{card} flex w-full items-center gap-3 text-left hover:bg-(--xcwds-shell-hover-bg)"
								onclick={() => add(template)}
							>
								<span aria-hidden="true" class="text-2xl">{template.emoji ?? '🧩'}</span>
								<span class="flex flex-col">
									<span class="font-medium">Add {template.name}</span>
									<span class={muted}
										>{describe(template)}{template.private ? ' · Private' : ''}</span
									>
								</span>
							</button>
						</li>
					{/each}
				</ul>
				{#if error}
					<p class="text-sm text-red-700 dark:text-red-400" role="alert">{error}</p>
				{/if}
			</section>
		{/if}
	</div>
{/if}
