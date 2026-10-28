<script lang="ts">
	import Camera from '@xcwds/plugin-camera/Camera.svelte';
	import type { Photo } from '@xcwds/plugin-camera/client';
	import Crop from '@xcwds/plugin-scanner/Crop.svelte';
	import Pages from '@xcwds/plugin-scanner/Pages.svelte';
	import type { Filter, Paper } from '@xcwds/plugin-scanner/client';

	// The photo being cropped; the viewfinder shows again once its page is added or it's cancelled.
	let photo = $state<Blob>();
	let filter = $state<Filter>('original');
	/** The page a Retake replaces, until its photo is cropped or cancelled. */
	let retake = $state<string>();
	let paper = $state<Paper>('a4');

	const done = (page?: { paper: Paper | null }) => {
		// A page that's the shape of Letter suggests the scan is on Letter.
		if (page?.paper) paper = page.paper;
		photo = undefined;
		retake = undefined;
	};
</script>

<main class="page-narrow flex flex-col gap-4 pt-2">
	{#if photo}
		<Crop {photo} {retake} bind:filter onDone={done} onCancel={() => done()} />
	{:else}
		{#if retake}
			<p class="flex flex-wrap items-center gap-3" data-testid="retaking">
				Take the page again.
				<button
					type="button"
					class="min-h-11 rounded-xl bg-(--xcwds-shell-card) px-4 font-medium"
					onclick={() => (retake = undefined)}>Cancel retake</button
				>
			</p>
		{/if}
		<Camera onCapture={(p: Photo) => void (photo = p.blob)} />
		<Pages bind:paper onRetake={(id) => (retake = id)} />
	{/if}
</main>
