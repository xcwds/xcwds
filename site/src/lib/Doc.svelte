<script lang="ts">
	/** A docs or reference page: the Markdown, its API from the types, and a contents list. */
	import { href } from './href.js';
	import Members from './Members.svelte';
	import type { DocPage } from './server/load.js';

	let { page }: { page: DocPage } = $props();
	const api = $derived(page.api);
	const sections = $derived(
		api
			? [
					...(api.options?.members.length
						? [{ title: `Options (${api.options.name})`, prefix: '', members: api.options.members }]
						: []),
					...(api.app.length ? [{ title: 'Decorators', prefix: 'app.', members: api.app }] : []),
					...(api.settings.length
						? [{ title: 'Settings fields', prefix: 'settings.', members: api.settings }]
						: []),
					...(api.hooks.length ? [{ title: 'Hooks', prefix: '', members: api.hooks }] : [])
				]
			: []
	);
</script>

<div class="lg:grid lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-10">
	<article class="prose min-w-0">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- Markdown from this repository, rendered at build time -->
		{@html page.html}
		{#if sections.length}
			<h2 id="api"><a class="anchor" href="#api">API</a></h2>
			<p>From the package's types and doc comments.</p>
			{#each sections as section (section.title)}
				<h3>{section.title}</h3>
				<Members members={section.members} prefix={section.prefix} />
			{/each}
		{/if}
		<nav class="pager" aria-label="More pages">
			{#if page.prev}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href() resolves paths from data -->
				<a href={href(page.prev.path)}>← {page.prev.title}</a>
			{:else}
				<span></span>
			{/if}
			{#if page.next}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href() resolves paths from data -->
				<a href={href(page.next.path)}>{page.next.title} →</a>
			{/if}
		</nav>
		<p class="edit">
			<a href="https://github.com/xcwds/xcwds/blob/main/{page.file}" rel="noreferrer">
				Edit this page on GitHub
			</a>
		</p>
	</article>
	{#if page.headings.length > 1}
		<nav class="toc hidden lg:block" aria-label="On this page">
			<p>On this page</p>
			<ul>
				{#each page.headings as heading (heading.id)}
					<li><a href="#{heading.id}">{heading.text}</a></li>
				{/each}
			</ul>
		</nav>
	{/if}
</div>
