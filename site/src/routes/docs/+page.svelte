<script lang="ts">
	import PageList from '#lib/PageList.svelte';

	let { data } = $props();
</script>

<main class="page-wide flex flex-col gap-6 pt-2 pb-8"><PageList pages={data.pages} /></main>
