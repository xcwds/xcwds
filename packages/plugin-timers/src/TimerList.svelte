<script lang="ts">
	/**
	 * Every timer, with a form to start a new one: what a timers page renders. While it shows,
	 * finished timers aren't also shown as alerts. While `@xcwds/plugin-lock` has the app locked,
	 * a timer started on a page it keeps out shows `privateText` instead of its label.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import type { TimerItem } from './client.js';
	import { MINUTE, formatDuration, running } from './timer.js';
	import { useHides } from './hides.svelte.js';

	let { privateText = 'Private timer' }: { privateText?: string } = $props();
	const timers = useApp().timers;
	const hides = useHides();
	let items = $state<readonly TimerItem[]>([]);
	// Read with `items`, so remaining times follow every tick.
	let now = $state(0);
	$effect(() =>
		timers?.subscribe((list) => {
			items = list;
			now = timers.now();
		})
	);
	onMount(() => timers?.show());

	const uid = $props.id();
	let label = $state('');
	let minutes = $state<number | null>(5);
	let error = $state('');

	function start(event: SubmitEvent) {
		event.preventDefault();
		if (!minutes || minutes <= 0 || minutes > 7 * 24 * 60) {
			error = 'Enter minutes between 1 and 10080.';
			return;
		}
		error = '';
		timers?.create(label, minutes * MINUTE);
		label = '';
	}

	const button =
		'min-h-11 min-w-11 rounded-xl bg-(--xcwds-shell-card) px-3 text-sm font-medium hover:bg-(--xcwds-shell-hover-bg)';
</script>

<form class="flex flex-wrap items-end gap-2" novalidate onsubmit={start}>
	<label class="flex min-w-0 flex-1 flex-col gap-1 text-sm">
		<span>Label</span>
		<input
			class="min-h-11 rounded-xl border border-(--xcwds-shell-border) bg-(--xcwds-shell-card) px-3"
			bind:value={label}
			placeholder="Pasta"
			maxlength="60"
		/>
	</label>
	<label class="flex w-28 flex-col gap-1 text-sm">
		<span>Minutes</span>
		<input
			class="min-h-11 rounded-xl border border-(--xcwds-shell-border) bg-(--xcwds-shell-card) px-3"
			type="number"
			inputmode="numeric"
			min="1"
			max="10080"
			bind:value={minutes}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? `${uid}-error` : undefined}
		/>
	</label>
	<button type="submit" class="{button} bg-(--xcwds-shell-accent) text-white">Start</button>
	{#if error}<p id="{uid}-error" class="w-full text-sm text-red-700 dark:text-red-400">
			{error}
		</p>{/if}
</form>

{#if items.length}
	<ul class="flex flex-col gap-2" data-testid="timers">
		{#each items as item (item.id)}
			{@const left =
				item.state.endsAt === null ? item.state.pausedRemaining : item.state.endsAt - now}
			{@const ringing = running(item.state) && left <= 0}
			{@const name = hides(item.path) ? privateText : item.label}
			<li
				class="flex flex-wrap items-center gap-2 rounded-xl px-4 py-2 {ringing
					? 'bg-amber-300 text-gray-900 dark:bg-amber-700 dark:text-white'
					: 'bg-(--xcwds-shell-card)'}"
				data-testid="timer"
			>
				<span class="min-w-0 flex-1 truncate font-medium">{name}</span>
				<span class="font-mono text-xl tabular-nums" role="timer" aria-label="{name} remaining"
					>{ringing ? 'Done' : formatDuration(left)}</span
				>
				{#if ringing}
					<button type="button" class={button} onclick={() => timers?.add(item.id, MINUTE)}
						>+1 min</button
					>
					<button type="button" class={button} onclick={() => timers?.remove(item.id)}>Stop</button>
				{:else}
					<button type="button" class={button} onclick={() => timers?.toggle(item.id)}
						>{running(item.state) ? 'Pause' : 'Resume'}</button
					>
					<button type="button" class={button} onclick={() => timers?.add(item.id, MINUTE)}
						>+1 min</button
					>
					<button
						type="button"
						class={button}
						aria-label="Remove {item.label}"
						onclick={() => timers?.remove(item.id)}>✕</button
					>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
