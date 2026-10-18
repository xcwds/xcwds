<script lang="ts">
	import { resolve } from '$app/paths';
	import Home from '@xcwds/plugin-shell/Home.svelte';
	import NavPicker from '@xcwds/plugin-shell/NavPicker.svelte';
	import InstallCard from '@xcwds/plugin-install/InstallCard.svelte';
	import ThemePicker from '@xcwds/plugin-theme/ThemePicker.svelte';
	import type {} from '@xcwds/plugin-update/client';
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';

	// Something a reload would interrupt, like a running timer (@xcwds/plugin-update).
	let working = $state(false);
	const update = useApp().update;
	onMount(() => update?.markBusy('work', () => working));

	// Links to paths only the example plugin's onNavigate guard handles. They exist only in the
	// browser, so prerendering (which runs no guards) doesn't crawl them.
	let mounted = $state(false);
	onMount(() => (mounted = true));
	const guarded = [
		'/moved',
		'/blocked',
		'/loop',
		'/slow',
		'/hello?wait',
		'/hello?now',
		'/hello?once',
		'/hello?bounce'
	];
	// They aren't routes, so the app's route types don't know them.
	const href = resolve as unknown as (path: string) => string;
</script>

<Home>
	<p><a href={resolve('/hello')}>A plugin's page</a></p>
	<ThemePicker />
	<InstallCard />
	{#if mounted}
		<button type="button" data-testid="work" onclick={() => (working = !working)}>
			{working ? 'Stop working' : 'Start working'}
		</button>
		<ul>
			{#each guarded as path (path)}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<li><a href={href(path)}>Guarded {path}</a></li>
			{/each}
		</ul>
	{/if}
	<NavPicker />
</Home>
