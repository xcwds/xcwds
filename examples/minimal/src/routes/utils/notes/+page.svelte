<script lang="ts">
	import type {} from '@xcwds/plugin-shell/client';
	import { useApp } from '@xcwds/sveltekit';

	const app = useApp();
	// Opened as /utils/notes#<title>, it titles itself on arrival, like an app made of blocks.
	$effect(() => {
		const title = decodeURIComponent(location.hash.slice(1));
		if (title) app.shell?.setTitle(title);
	});
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
	<label class="flex flex-col gap-1">
		Note
		<textarea class="min-h-24 rounded-xl border p-2"></textarea>
	</label>
</main>
