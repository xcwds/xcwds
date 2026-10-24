<script lang="ts">
	/**
	 * One saved Notion page (#107): its icon and title (an `<h2>`, since the shell's header holds the
	 * `<h1>`), its properties, then its blocks. It reads only the plugin's saved format, so other
	 * plugins and apps can show a copy with it too. Saved images need `image` (`app.notion.image`,
	 * as `<NotionView>` passes it); without it they say they aren't on the device.
	 */
	import Blocks from './Blocks.svelte';
	import RichText from './RichText.svelte';
	import type { NotionDocument as Doc } from './document.js';
	import { propertyHref, propertyText, safeHref } from './render.js';

	let {
		document,
		image
	}: { document: Doc; image?: ((id: string) => Promise<Blob | undefined>) | undefined } = $props();
	const url = $derived(safeHref(document.url));
	const properties = $derived(
		document.properties.filter((p) => p.type === 'checkbox' || propertyText(p) !== '')
	);
</script>

<!-- Every link here leaves the app (Notion's own links, checked by `safeHref`), so it isn't a route to resolve. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
<article class="flex flex-col gap-3 leading-relaxed" data-testid="notion-document">
	<h2 class="text-2xl font-bold">
		{#if document.icon}<span aria-hidden="true">{document.icon}</span>{/if}
		{document.title || 'Untitled'}
	</h2>
	{#if properties.length}
		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
			{#each properties as property, i (i)}
				{@const href = propertyHref(property)}
				<dt class="opacity-70">{property.name}</dt>
				<dd class="min-w-0 break-words">
					{#if property.type === 'text'}<RichText runs={property.text} />
					{:else if href}<a
							{href}
							target="_blank"
							rel="noopener noreferrer"
							class="underline underline-offset-2">{propertyText(property)}</a
						>
					{:else}{propertyText(property)}{/if}
				</dd>
			{/each}
		</dl>
	{/if}
	<div class="flex flex-col gap-2"><Blocks blocks={document.blocks} {url} {image} /></div>
	{#if document.truncated}
		<p class="text-sm opacity-70" data-notion="truncated">
			This page is longer than a download takes, so it stops here.
			{#if url}<a
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex min-h-11 items-center underline underline-offset-2">Open in Notion</a
				>{/if}
		</p>
	{/if}
</article>
