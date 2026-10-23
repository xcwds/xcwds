<script lang="ts">
	/** Runs of Notion text with their formatting; links only for safe schemes (`safeHref`). */
	import type { RichText as Run } from './document.js';
	import { runClass, safeHref } from './render.js';

	let { runs }: { runs: readonly Run[] } = $props();
</script>

<!-- Every link here leaves the app (Notion's own links, checked by `safeHref`), so it isn't a route to resolve. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
{#each runs as run, i (i)}{@const href = safeHref(run.href)}{@const cls = runClass(run)}{#if href}<a
			{href}
			target="_blank"
			rel="noopener noreferrer"
			class="underline-offset-2 {runClass({ ...run, underline: true })}"
			>{#if run.code}<code>{run.text}</code>{:else}{run.text}{/if}</a
		>{:else if run.code}<code class={cls}>{run.text}</code>{:else if cls}<span class={cls}
			>{run.text}</span
		>{:else}{run.text}{/if}{/each}
