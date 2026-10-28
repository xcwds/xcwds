<script lang="ts">
	import Camera from '@xcwds/plugin-camera/Camera.svelte';
	import type { Photo } from '@xcwds/plugin-camera/client';
	import Crop from '@xcwds/plugin-scanner/Crop.svelte';
	import type { Filter } from '@xcwds/plugin-scanner/client';
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';

	const app = useApp();

	// The photo being cropped; the viewfinder shows again once its page is added or it's cancelled.
	let photo = $state<Blob>();
	let filter = $state<Filter>('original');
	/** Undefined until counted. */
	let pages = $state<number>();

	const count = async () => (pages = (await app.scanner?.pages.list())?.length ?? 0);
	onMount(() => {
		void count();
		return app.scanner?.pages.onChange(() => void count());
	});
</script>

<main class="page-narrow flex flex-col gap-4 pt-2">
	{#if photo}
		<Crop
			{photo}
			bind:filter
			onDone={() => (photo = undefined)}
			onCancel={() => (photo = undefined)}
		/>
	{:else}
		<Camera onCapture={(p: Photo) => void (photo = p.blob)} />
	{/if}
	{#if pages !== undefined}
		<p data-testid="scan-pages">{pages === 1 ? '1 page scanned' : `${pages} pages scanned`}</p>
	{/if}
</main>
