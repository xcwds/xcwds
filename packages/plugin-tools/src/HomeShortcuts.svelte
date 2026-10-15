<script lang="ts">
	/**
	 * Home's Pinned (in the user's order, with Edit to reorder or unpin) and Recently used tools.
	 * The plugin adds it to the shell's Home; it shows nothing until something is pinned or used.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { emptyShortcuts, type HomeShortcuts } from './home.js';
	import type { Tool } from './options.js';
	import { href } from './paths.js';
	import type {} from './types.js';

	const tools = useApp().tools;
	let shortcuts = $state<HomeShortcuts>(emptyShortcuts());
	$effect(() => tools?.shortcuts?.subscribe((s) => (shortcuts = s)));

	// Tools of apps that are off are hidden, not unpinned: they come back with the app.
	let shown = $state.raw(new Set(tools?.list().map((t) => t.path)));
	$effect(() => tools?.subscribe(() => (shown = new Set(tools.list().map((t) => t.path)))));
	const toolAt = (path: string) => (shown.has(path) ? tools?.get(path) : undefined);
	let pinned = $derived(shortcuts.pins.map(toolAt).filter((t): t is Tool => t !== undefined));
	// Recently used tools that aren't already pinned, nor private (a tool added at runtime can
	// arrive private after a recent of it was saved).
	let recent = $derived(
		shortcuts.recent
			.filter((p) => !shortcuts.pins.includes(p))
			.map(toolAt)
			.filter((t): t is Tool => t !== undefined && !t.private)
	);
	let editing = $state(false);
	// Leave edit mode once nothing is pinned, so a new pin doesn't open in it.
	$effect(() => {
		if (!pinned.length) editing = false;
	});

	const small =
		'min-h-11 min-w-11 rounded-lg bg-(--xcwds-shell-card) px-2 text-sm hover:bg-(--xcwds-shell-hover-bg) disabled:opacity-40';
	const heading = 'text-sm font-semibold tracking-wide text-(--xcwds-shell-muted) uppercase';
	const card =
		'flex items-center gap-3 rounded-xl bg-(--xcwds-shell-card) px-4 py-3 font-medium hover:bg-(--xcwds-shell-hover-bg)';
</script>

{#if pinned.length}
	<section class="flex flex-col gap-2" aria-labelledby="xcwds-pinned" data-testid="pinned">
		<div class="flex items-center justify-between">
			<h2 id="xcwds-pinned" class={heading}>Pinned</h2>
			<button
				type="button"
				class={small}
				aria-pressed={editing}
				onclick={() => (editing = !editing)}
			>
				{editing ? 'Done' : 'Edit'}
			</button>
		</div>
		<ul class="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
			{#each pinned as tool, i (tool.path)}
				<li class="flex items-stretch gap-2">
					<a href={href(tool.path)} class="{card} flex-1">
						<span aria-hidden="true" class="text-2xl">{tool.emoji}</span>
						<span>{tool.name}</span>
					</a>
					{#if editing}
						<button
							type="button"
							class={small}
							aria-label="Move {tool.name} up"
							disabled={i === 0}
							onclick={() => tools?.shortcuts?.movePin(tool.path, -1)}>↑</button
						>
						<button
							type="button"
							class={small}
							aria-label="Move {tool.name} down"
							disabled={i === pinned.length - 1}
							onclick={() => tools?.shortcuts?.movePin(tool.path, 1)}>↓</button
						>
						<button
							type="button"
							class={small}
							aria-label="Unpin {tool.name}"
							onclick={() => tools?.shortcuts?.togglePin(tool.path)}>✕</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if recent.length}
	<section class="flex flex-col gap-2" aria-labelledby="xcwds-recent" data-testid="recent">
		<h2 id="xcwds-recent" class={heading}>Recently used</h2>
		<ul class="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
			{#each recent as tool (tool.path)}
				<li>
					<a href={href(tool.path)} class="{card} h-full">
						<span aria-hidden="true" class="text-2xl">{tool.emoji}</span>
						<span>{tool.name}</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}
