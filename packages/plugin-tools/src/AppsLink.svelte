<script lang="ts">
	/**
	 * The `apps` setting on the settings page: a link to the Apps page, where each app has its own
	 * switch (one place to turn them on and off).
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { href } from './paths.js';
	import type {} from './types.js';

	const tools = useApp().tools;
	let on = $state(0);
	$effect(() => tools?.subscribe(() => (on = tools.apps().filter((a) => tools.isOn(a.id)).length)));
</script>

{#if tools?.catalog}
	<a
		href={href(tools.catalog)}
		class="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-(--xcwds-shell-card) px-4 py-2 hover:bg-(--xcwds-shell-hover-bg)"
		data-testid="apps-link"
	>
		<span class="flex flex-col">
			<span class="font-medium">Apps</span>
			<span class="text-sm text-(--xcwds-shell-muted)">
				{on} of {tools.apps().length} on
			</span>
		</span>
		<span aria-hidden="true">›</span>
	</a>
{/if}
