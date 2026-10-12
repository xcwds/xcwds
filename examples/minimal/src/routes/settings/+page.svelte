<script lang="ts">
	import SettingsPage from '@xcwds/plugin-settings/SettingsPage.svelte';
</script>

<main class="page-split pt-2 pb-6">
	<SettingsPage>
		{#snippet about()}
			<p class="text-sm" data-testid="about-extra">An example app for @xcwds.</p>
		{/snippet}
	</SettingsPage>
</main>
