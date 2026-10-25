<script lang="ts">
	/**
	 * A saved page's blocks (#107), drawn from the plugin's own format only. Text is always text
	 * (never `{@html}`), and blocks that aren't drawn here say so, with a link to the page in Notion.
	 * Saved images are read with `image` (`app.notion.image`); images from outside Notion are links,
	 * never loaded. To-dos are read-only unless `check` is given (#109): ticking one calls it with the
	 * block's id, and a `false` answer puts the box back.
	 */
	import Blocks from './Blocks.svelte';
	import NotionImage from './NotionImage.svelte';
	import RichText from './RichText.svelte';
	import { plainText, type Block } from './document.js';
	import {
		colorClass,
		externalHost,
		fileLabel,
		groupBlocks,
		headingTag,
		imageNote,
		safeHref
	} from './render.js';

	let {
		blocks,
		url,
		image,
		check
	}: {
		blocks: readonly Block[];
		url?: string | undefined;
		image?: ((id: string) => Promise<Blob | undefined>) | undefined;
		check?: ((block: string, checked: boolean) => boolean) | undefined;
	} = $props();

	function ticked(id: string, event: Event) {
		const box = event.currentTarget as HTMLInputElement;
		if (check && !check(id, box.checked)) box.checked = !box.checked;
	}
</script>

<!-- Every link here leaves the app (Notion's own links, checked by `safeHref`), so it isn't a route to resolve. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
{#snippet children(block: Block)}
	{#if 'children' in block && block.children?.length}
		<div class="mt-1 flex flex-col gap-2 ps-6">
			<Blocks blocks={block.children} {url} {image} {check} />
		</div>
	{/if}
{/snippet}

{#snippet notInNotion()}
	{#if url}<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex min-h-11 items-center underline underline-offset-2">Open in Notion</a
		>{/if}
{/snippet}

{#each groupBlocks(blocks) as group, i (i)}
	{#if group.kind === 'list'}
		<svelte:element
			this={group.ordered ? 'ol' : 'ul'}
			class="flex flex-col gap-1 ps-6 {group.ordered ? 'list-decimal' : 'list-disc'}"
		>
			{#each group.items as item, j (j)}
				<li class={colorClass(item.color)}>
					<RichText runs={item.text} />{@render children(item)}
				</li>
			{/each}
		</svelte:element>
	{:else}
		{@const block = group.block}
		{#if block.type === 'paragraph'}
			<div>
				<p class={colorClass(block.color)}><RichText runs={block.text} /></p>
				{@render children(block)}
			</div>
		{:else if block.type === 'heading'}
			{#if block.toggle}
				<details>
					<summary class="min-h-11 cursor-pointer py-2">
						<svelte:element
							this={headingTag(block.level)}
							class="inline font-semibold {colorClass(block.color)}"
							><RichText runs={block.text} /></svelte:element
						>
					</summary>
					{@render children(block)}
				</details>
			{:else}
				<svelte:element
					this={headingTag(block.level)}
					class="mt-2 font-semibold {['text-xl', 'text-lg', 'text-base'][
						block.level - 1
					]} {colorClass(block.color)}"><RichText runs={block.text} /></svelte:element
				>
			{/if}
		{:else if block.type === 'todo'}
			<div>
				<label class="flex min-h-11 items-start gap-2 py-2.5 {colorClass(block.color)}">
					{#if check && block.id}
						{@const id = block.id}
						<input
							type="checkbox"
							class="mt-1 size-4 shrink-0"
							checked={block.checked}
							onchange={(event) => ticked(id, event)}
						/>
					{:else}
						<input type="checkbox" class="mt-1 size-4 shrink-0" checked={block.checked} disabled />
					{/if}
					<span class={block.checked ? 'line-through opacity-70' : ''}
						><RichText runs={block.text} /></span
					>
				</label>
				{@render children(block)}
			</div>
		{:else if block.type === 'toggle'}
			<details class={colorClass(block.color)}>
				<summary class="min-h-11 cursor-pointer py-2"><RichText runs={block.text} /></summary>
				{@render children(block)}
			</details>
		{:else if block.type === 'quote'}
			<blockquote class="border-s-4 border-current/30 ps-4 {colorClass(block.color)}">
				<p><RichText runs={block.text} /></p>
				{@render children(block)}
			</blockquote>
		{:else if block.type === 'callout'}
			<aside
				class="flex gap-3 rounded-xl p-3 {colorClass(block.color) || 'bg-black/5 dark:bg-white/10'}"
			>
				{#if block.icon}<span aria-hidden="true">{block.icon}</span>{/if}
				<div class="flex min-w-0 flex-col gap-2">
					<p><RichText runs={block.text} /></p>
					{@render children(block)}
				</div>
			</aside>
		{:else if block.type === 'code'}
			<figure class="flex flex-col gap-1">
				<pre
					class="overflow-x-auto rounded-xl bg-black/5 p-3 text-sm dark:bg-white/10"
					data-language={block.language}><code>{block.text.map((run) => run.text).join('')}</code
					></pre>
				{#if block.caption.length}<figcaption class="text-sm opacity-70">
						<RichText runs={block.caption} />
					</figcaption>{/if}
			</figure>
		{:else if block.type === 'divider'}
			<hr class="border-current/20" />
		{:else if block.type === 'table'}
			<div class="overflow-x-auto">
				<table class="border-collapse text-sm">
					{#if block.columnHeader && block.rows.length}
						<thead>
							<tr>
								{#each block.rows[0] as cell, c (c)}
									<th scope="col" class="border border-current/20 p-2 text-start font-semibold"
										><RichText runs={cell} /></th
									>
								{/each}
							</tr>
						</thead>
					{/if}
					<tbody>
						{#each block.columnHeader ? block.rows.slice(1) : block.rows as row, r (r)}
							<tr>
								{#each row as cell, c (c)}
									{#if block.rowHeader && c === 0}
										<th scope="row" class="border border-current/20 p-2 text-start font-semibold"
											><RichText runs={cell} /></th
										>
									{:else}
										<td class="border border-current/20 p-2"><RichText runs={cell} /></td>
									{/if}
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else if block.type === 'child_page' || block.type === 'child_database'}
			<p>
				<span aria-hidden="true">{block.type === 'child_page' ? '📄' : '🗃️'}</span>
				{block.title || 'Untitled'}
			</p>
		{:else if block.type === 'link_to_page'}
			<p>
				<span aria-hidden="true">↗</span>
				{block.kind === 'page' ? 'Linked page' : 'Linked database'}
			</p>
		{:else if block.type === 'bookmark' || block.type === 'embed'}
			<p>
				<RichText runs={[{ text: block.url, href: block.url }]} />
				{#if block.caption.length}<span class="block text-sm opacity-70"
						><RichText runs={block.caption} /></span
					>{/if}
			</p>
		{:else if block.type === 'equation'}
			<p><code class="font-mono">{block.expression}</code></p>
		{:else if block.type === 'columns'}
			<div class="grid gap-4 md:auto-cols-fr md:grid-flow-col">
				{#each block.columns as column, c (c)}
					<div class="flex min-w-0 flex-col gap-2">
						<Blocks blocks={column} {url} {image} {check} />
					</div>
				{/each}
			</div>
		{:else if block.type === 'image'}
			{@const external = block.external ? safeHref(block.external) : undefined}
			<figure class="flex flex-col gap-1">
				{#if block.file}
					<NotionImage
						id={block.file}
						alt={block.caption.length ? plainText(block.caption) : 'Image'}
						load={image}
					/>
				{:else if external}
					<p
						class="rounded-xl border border-dashed border-current/30 p-3 text-sm"
						data-notion="image-external"
					>
						Image from another site, not loaded here:
						<a
							href={external}
							target="_blank"
							rel="noopener noreferrer"
							class="inline-flex min-h-11 items-center underline underline-offset-2"
							>Open it on {externalHost(external)}</a
						>
					</p>
				{:else}
					<p
						class="rounded-xl border border-dashed border-current/30 p-3 text-sm"
						data-notion="image-skipped"
					>
						{imageNote(block.skipped)}
						{@render notInNotion()}
					</p>
				{/if}
				{#if block.caption.length}<figcaption class="text-sm opacity-70">
						<RichText runs={block.caption} />
					</figcaption>{/if}
			</figure>
		{:else if block.type === 'file'}
			<p class="rounded-xl border border-dashed border-current/30 p-3 text-sm" data-notion="file">
				{fileLabel(block.notionType)} not shown here yet.
				{#if block.caption.length}<span class="block opacity-70"
						><RichText runs={block.caption} /></span
					>{/if}
				{@render notInNotion()}
			</p>
		{:else}
			<p class="text-sm opacity-70" data-notion="unsupported">
				Not shown here.
				{@render notInNotion()}
			</p>
		{/if}
	{/if}
{/each}
