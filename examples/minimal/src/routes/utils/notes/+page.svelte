<script lang="ts">
	import type {} from '@xcwds/plugin-shell/client';
	import type {} from '@xcwds/plugin-tools/client';
	import { useApp } from '@xcwds/sveltekit';

	const app = useApp();
	// Opened as /utils/notes#<title>, it titles itself on arrival, like an app made of blocks.
	$effect(() => {
		let title = '';
		try {
			title = decodeURIComponent(location.hash.slice(1));
		} catch {
			// A malformed fragment (#%E0) is no title.
		}
		if (title) app.shell?.setTitle(title);
	});
	// A tool added at runtime on this page, the way an app made of blocks adds itself (#160).
	const GROCERIES = '/utils/notes#groceries';
	let listed = $state(false);
	$effect(() => app.tools?.subscribe(() => (listed = !!app.tools?.get(GROCERIES))));
</script>

<main class="page-narrow pt-2">
	<p data-testid="tool">Jot something down.</p>
	<!-- Titles the page while it's open (app.shell.setTitle), like an app made of blocks. -->
	<label class="flex flex-col gap-1">
		Title
		<input
			class="min-h-11 rounded-xl border p-2"
			oninput={(e) => app.shell?.setTitle(e.currentTarget.value)}
		/>
	</label>
	{#if listed}
		<button
			type="button"
			class="min-h-11 self-start rounded-xl border px-3"
			onclick={() => app.tools?.remove(GROCERIES)}>Remove Groceries from tools</button
		>
	{:else}
		<button
			type="button"
			class="min-h-11 self-start rounded-xl border px-3"
			onclick={() =>
				app.tools?.add({
					path: GROCERIES,
					name: 'Groceries',
					emoji: '🛒',
					blurb: 'A note made a tool.'
				})}>Add Groceries to tools</button
		>
	{/if}
	<label class="flex flex-col gap-1">
		Note
		<textarea class="min-h-24 rounded-xl border p-2"></textarea>
	</label>
</main>
