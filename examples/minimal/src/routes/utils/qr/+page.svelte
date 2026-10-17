<script lang="ts">
	import QrCode from '@xcwds/plugin-qr/QrCode.svelte';

	// Drawn on the device: the text never leaves it.
	let text = $state('https://example.com');
</script>

<main class="page-narrow flex flex-col gap-4 pt-2">
	<label class="flex flex-col gap-1">
		Text or link
		<textarea class="min-h-11 rounded-xl border p-2" rows="3" bind:value={text}></textarea>
	</label>
	<QrCode value={text} class="w-full max-w-xs self-center" />
</main>
