<script lang="ts">
	/** Runs of Notion text with their formatting; links only for safe schemes (`safeHref`). */
	import type { RichText as Run } from './document.js';
	import { runClass, safeHref } from './render.js';

	let { runs }: { runs: readonly Run[] } = $props();
</script>

{#each runs as run, i (i)}{@const href = safeHref(run.href)}{@const cls = runClass(run)}{#if href}<a
			{href}
			target="_blank"
			rel="noopener noreferrer"
			class="underline underline-offset-2 {cls}"
			>{#if run.code}<code>{run.text}</code>{:else}{run.text}{/if}</a
		>{:else if run.code}<code class={cls}>{run.text}</code>{:else if cls}<span class={cls}
			>{run.text}</span
		>{:else}{run.text}{/if}{/each}
