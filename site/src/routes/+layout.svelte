<script lang="ts">
	import Notices from '#lib/Notices.svelte';
	import Shell from '@xcwds/plugin-shell/Shell.svelte';
	import { App } from '@xcwds/sveltekit';
	import '../app.css';

	let { children } = $props();
</script>

<App>
	<Shell>
		{@render children()}
		{#snippet notices()}
			<Notices />
		{/snippet}
	</Shell>
</App>
