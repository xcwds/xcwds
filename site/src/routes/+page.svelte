<script lang="ts">
	import { resolve } from '$app/paths';
	import PageList from '$lib/PageList.svelte';
	import Home from '@xcwds/plugin-shell/Home.svelte';

	const start = [
		{
			path: '/docs/getting-started',
			emoji: '🚀',
			title: 'Get started',
			blurb: 'Make an app and put it on your phone.'
		},
		{
			path: '/docs/concepts',
			emoji: '💡',
			title: 'Concepts',
			blurb: 'Plugins, hooks, decorators, saved data and updates.'
		},
		{
			path: '/docs/plugin-guide',
			emoji: '🧩',
			title: 'Write a plugin',
			blurb: 'Build, test and use a plugin of your own.'
		},
		{
			path: '/reference',
			emoji: '📚',
			title: 'Reference',
			blurb: 'Every package, its options and its API.'
		},
		{
			path: '/docs/ecosystem',
			emoji: '🌱',
			title: 'Ecosystem',
			blurb: 'First-party and community plugins.'
		},
		{
			path: '/tally',
			emoji: '🔢',
			title: 'Tally',
			blurb: 'The plugin the guide builds, running here.'
		}
	];
</script>

<Home>
	<section class="flex max-w-3xl flex-col gap-3">
		<p>
			An @xcwds app is a static site that installs like an app, works offline and keeps what people
			save on their device. You describe it in one config file, and every feature is a plugin, as in <a
				class="underline"
				href="https://fastify.dev"
				rel="noreferrer">Fastify</a
			>. This site is one: install it, and the docs work offline.
		</p>
		<pre class="overflow-x-auto rounded-xl bg-(--xcwds-shell-card) px-4 py-3 text-sm"><code
				>npm create @xcwds my-app</code
			></pre>
		<p class="text-sm text-(--xcwds-shell-muted)">
			<a class="underline" href={resolve('/docs/getting-started')}>Getting started</a> takes it from there
			to an app on your phone.
		</p>
	</section>
	<PageList pages={start} />
</Home>
