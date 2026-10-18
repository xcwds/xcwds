<script lang="ts">
	import PageList from '#lib/PageList.svelte';

	let { data } = $props();
	const plugins = $derived(data.pages.filter((p) => p.path.startsWith('/reference/plugin-')));
	const blocks = $derived(data.pages.filter((p) => !p.path.startsWith('/reference/plugin-')));
</script>

<main class="page-wide flex flex-col gap-6 pt-2 pb-8">
	<section class="flex flex-col gap-3">
		<h2 class="text-lg font-semibold">Building blocks</h2>
		<PageList pages={blocks} />
	</section>
	<section class="flex flex-col gap-3">
		<h2 class="text-lg font-semibold">Plugins</h2>
		<PageList pages={plugins} />
	</section>
</main>
