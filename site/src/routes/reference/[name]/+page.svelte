<script lang="ts">
	import Doc from '#lib/Doc.svelte';

	let { data } = $props();
</script>

<main class="page-wide pt-2 pb-8"><Doc page={data} /></main>
