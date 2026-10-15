<script lang="ts">
	/**
	 * The index page: every tool with its blurb, and a ☆ button that pins it to Home. Render it
	 * from the index page's route file, inside `<main class="page-wide">`. With apps (#158), it
	 * lists the tools of apps that are on, and links to the Apps page.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { emptyShortcuts, type HomeShortcuts } from './home.js';
	import { href } from './paths.js';
	import type {} from './types.js';

	const tools = useApp().tools;
	/** The tools of apps that are on (and those in no app). */
	let list = $state.raw(tools?.list() ?? []);
	$effect(() => tools?.subscribe(() => (list = tools.list())));
	let shortcuts = $state<HomeShortcuts>(emptyShortcuts());
	$effect(() => tools?.shortcuts?.subscribe((s) => (shortcuts = s)));
</script>

<ul class="grid gap-2 md:grid-cols-2 lg:grid-cols-3" data-testid="tools">
	{#each list as tool (tool.path)}
		{@const pinned = shortcuts.pins.includes(tool.path)}
		<li class="flex items-stretch gap-2">
			<a
				href={href(tool.path)}
				class="flex flex-1 items-center gap-3 rounded-xl bg-(--xcwds-shell-card) px-4 py-3 hover:bg-(--xcwds-shell-hover-bg)"
			>
				<span aria-hidden="true" class="text-2xl">{tool.emoji}</span>
				<span class="flex flex-col">
					<span class="font-medium">{tool.name}</span>
					<span class="text-sm text-(--xcwds-shell-muted)">{tool.blurb}</span>
				</span>
			</a>
			<button
				type="button"
				class="min-w-11 rounded-xl px-2 text-xl {pinned
					? 'bg-(--xcwds-tools-pinned-bg)'
					: 'bg-(--xcwds-shell-card) hover:bg-(--xcwds-shell-hover-bg)'}"
				aria-pressed={pinned}
				aria-label="Pin {tool.name} to Home"
				onclick={() => tools?.shortcuts?.togglePin(tool.path)}
			>
				<span aria-hidden="true">{pinned ? '★' : '☆'}</span>
			</button>
		</li>
	{/each}
</ul>
<p class="text-sm text-(--xcwds-shell-muted)">
	Pin the tools you use most (☆) to reach them from Home in one tap.
</p>
{#if tools?.catalog}
	<a
		href={href(tools.catalog)}
		class="flex min-h-11 items-center gap-3 self-start rounded-xl bg-(--xcwds-shell-card) px-4 py-2 font-medium hover:bg-(--xcwds-shell-hover-bg)"
		data-testid="apps-link"
	>
		<span aria-hidden="true">🧩</span> Choose apps
	</a>
{/if}
