<script lang="ts">
	import { resolve } from '$app/paths';
	import ToolList from '@xcwds/plugin-tools/ToolList.svelte';
</script>

<main class="page-wide flex flex-col gap-6 pt-2 pb-6">
	<ToolList />
	<a
		href={resolve('/my-apps')}
		class="flex min-h-11 items-center self-start rounded-xl bg-(--xcwds-shell-card) px-4 hover:bg-(--xcwds-shell-hover-bg)"
		data-testid="your-apps-link">🧩 Your apps</a
	>
</main>
