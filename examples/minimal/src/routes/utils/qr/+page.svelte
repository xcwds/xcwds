<script lang="ts">
	import QrCode from '@xcwds/plugin-qr/QrCode.svelte';
	import { scan, type ScanResult } from '@xcwds/plugin-qr/scan';

	// Drawn and read on the device: the text never leaves it.
	let text = $state('https://example.com');

	let picker = $state<HTMLInputElement>();
	let reading = $state(false);
	let found = $state<ScanResult | null>();
	let error = $state('');

	async function read(file: File | undefined) {
		if (!file) return;
		reading = true;
		error = '';
		found = undefined;
		try {
			found = await scan(file);
		} catch {
			error = "That image couldn't be read.";
		} finally {
			reading = false;
			if (picker) picker.value = '';
		}
	}
</script>

<main class="page-narrow flex flex-col gap-4 pt-2">
	<label class="flex flex-col gap-1">
		Text or link
		<textarea class="min-h-11 rounded-xl border p-2" rows="3" bind:value={text}></textarea>
	</label>
	<QrCode value={text} class="w-full max-w-xs self-center" />

	<input
		bind:this={picker}
		type="file"
		accept="image/*"
		class="hidden"
		data-testid="qr-file"
		onchange={(e) => read(e.currentTarget.files?.[0])}
	/>
	<button
		type="button"
		class="min-h-11 self-start rounded-xl border px-3"
		disabled={reading}
		onclick={() => picker?.click()}>{reading ? 'Reading…' : 'Read a code from an image'}</button
	>
	{#if error}
		<p class="text-sm text-red-700 dark:text-red-400">{error}</p>
	{:else if found === null}
		<p data-testid="qr-found">No code found in that image.</p>
	{:else if found}
		<!-- Shown, never opened: the page decides what a link does. -->
		<p data-testid="qr-found" data-kind={found.kind}>
			{found.kind === 'wifi' ? `Wi-Fi: ${found.wifi?.ssid}` : found.text}
		</p>
	{/if}
</main>
