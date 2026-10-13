<script lang="ts">
	import type {} from '@xcwds-example/plugin-hello/client';
	import type {} from '@xcwds/plugin-timers/client';
	import { persist, useApp } from '@xcwds/sveltekit';

	const app = useApp();
	let entry = $state('');
	// Saved as sensitive: resetting a forgotten passcode clears it.
	persist(
		app.hello.journal,
		() => entry || undefined,
		(v) => (entry = v),
		{ cleared: () => (entry = '') }
	);
</script>

<main class="page-narrow pt-2">
	<p data-testid="tool">Only on this device.</p>
	<label class="flex flex-col gap-1">
		Entry
		<textarea class="min-h-24 rounded-xl border p-2" bind:value={entry}></textarea>
	</label>
	<!-- A timer started here: its alert hides the label while the app is locked. -->
	<button
		type="button"
		class="min-h-11 self-start rounded-xl border px-3"
		onclick={() => app.timers?.create('Journal reminder', 60_000)}>Remind me in a minute</button
	>
	<!-- Sets its own spellcheck, which @xcwds/plugin-lock keeps. -->
	<label class="flex flex-col gap-1">
		Title
		<input class="min-h-11 rounded-xl border p-2" spellcheck="true" />
	</label>
</main>
