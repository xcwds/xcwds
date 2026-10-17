<script lang="ts">
	import Camera from '@xcwds/plugin-camera/Camera.svelte';
	import Photos from '@xcwds/plugin-camera/Photos.svelte';
	import type { Photo } from '@xcwds/plugin-camera/client';
	import { readMetadata } from '@xcwds/plugin-camera/image';
	import { useApp } from '@xcwds/sveltekit';
	import { onDestroy, onMount } from 'svelte';

	const app = useApp();

	type Shown = { url: string; width: number; height: number; type: string; carries: string[] };
	// The last photo, shown below the viewfinder, and kept in `app.photos`.
	let photo = $state<Shown>();
	/** Undefined until counted. */
	let kept = $state<number>();
	let error = $state('');

	const count = async () => (kept = (await app.photos?.list())?.length ?? 0);
	onMount(() => {
		void count();
		return app.photos?.onChange(() => void count());
	});

	async function show(p: Photo) {
		error = '';
		const saved = await app.photos?.save(p);
		if (saved && !saved.ok) error = saved.error;
		await count();
		const bytes = new Uint8Array(await p.blob.arrayBuffer());
		const found = readMetadata(bytes);
		const carries = (['exif', 'gps', 'xmp', 'other'] as const).filter((key) => found[key]);
		if (photo) URL.revokeObjectURL(photo.url);
		photo = {
			url: URL.createObjectURL(p.blob),
			width: p.width,
			height: p.height,
			type: p.type,
			carries
		};
	}
	onDestroy(() => photo && URL.revokeObjectURL(photo.url));
</script>

<main class="page-narrow flex flex-col gap-4 pt-2">
	<Camera onCapture={show} />
	{#if kept !== undefined}
		<p data-testid="kept">{kept === 1 ? '1 photo kept' : `${kept} photos kept`}</p>
	{/if}
	{#if error}
		<p class="text-sm text-red-700 dark:text-red-400">{error}</p>
	{/if}
	{#if photo}
		<figure class="flex flex-col gap-2" data-testid="photo">
			<img src={photo.url} alt="The last one taken" class="w-full rounded-xl" />
			<figcaption class="text-sm">
				{photo.width} × {photo.height}, {photo.type}, {photo.carries.length
					? `carries ${photo.carries.join(', ')}`
					: 'no metadata'}
			</figcaption>
		</figure>
	{/if}
	<Photos />
</main>
