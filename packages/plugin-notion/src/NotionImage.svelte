<script lang="ts">
	/**
	 * One saved image of a copy (#108), read from the device with `load` (`app.notion.image`) and
	 * shown from an object URL, which is let go of when the image leaves the page. Nothing shows
	 * until it's read (so the prerendered page has none), and an image that isn't on the device any
	 * more says so.
	 */
	let {
		id,
		alt,
		load
	}: { id: string; alt: string; load?: ((id: string) => Promise<Blob | undefined>) | undefined } =
		$props();

	let src = $state<string>();
	let missing = $state(false);

	$effect(() => {
		let url: string | undefined;
		let gone = false;
		src = undefined;
		missing = false;
		void (load?.(id) ?? Promise.resolve(undefined)).then(
			(blob) => {
				if (gone) return;
				if (!blob) {
					missing = true;
					return;
				}
				url = URL.createObjectURL(blob);
				src = url;
			},
			() => {
				if (!gone) missing = true;
			}
		);
		return () => {
			gone = true;
			if (url) URL.revokeObjectURL(url);
		};
	});
</script>

{#if src}
	<img {src} {alt} class="h-auto max-w-full rounded-xl" data-notion="image" />
{:else if missing}
	<p
		class="rounded-xl border border-dashed border-current/30 p-3 text-sm"
		data-notion="image-missing"
	>
		This image isn’t on this device any more. Refresh to download it again.
	</p>
{/if}
