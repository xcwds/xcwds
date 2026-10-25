<script lang="ts">
	// The share target (@xcwds/plugin-share): shows what another app shared.
	import type { Shared } from '@xcwds/plugin-share';
	import type {} from '@xcwds/plugin-share/client';
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';

	const app = useApp();
	let shared = $state<Shared | null>(null);
	onMount(() => app.shared?.listen((value) => (shared = value)));
</script>

<main class="page-narrow">
	{#if shared}
		{#if shared.joined}<p data-testid="shared">{shared.joined}</p>{/if}
		{#if shared.title}<p data-testid="shared-title">{shared.title}</p>{/if}
		{#each shared.files ?? [] as file, i (i)}
			<p data-testid="shared-file">{file.name} ({file.type}, {file.size} bytes)</p>
		{/each}
		{#if shared.skipped}<p data-testid="shared-skipped">{shared.skipped} not kept</p>{/if}
	{:else}
		<p>Nothing shared yet.</p>
	{/if}
</main>
