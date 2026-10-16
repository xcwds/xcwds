<script lang="ts">
	import Camera from '@xcwds/plugin-camera/Camera.svelte';
	import type { Photo } from '@xcwds/plugin-camera/client';
	import { readMetadata } from '@xcwds/plugin-camera/image';
	import { onDestroy } from 'svelte';

	type Shown = { url: string; width: number; height: number; type: string; carries: string[] };
	// The last photo, shown below the viewfinder; nothing is kept (that's #146).
	let photo = $state<Shown>();

	async function show(p: Photo) {
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
</main>
