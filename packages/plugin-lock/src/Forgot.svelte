<script lang="ts">
	/**
	 * "Forgot passcode": there's no recovery, so it resets the lock and clears every storage
	 * group marked `sensitive`, after two confirmations that name those groups.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import type { Group } from '@xcwds/core';
	import type {} from './client.js';
	import { toast, ui } from './ui.js';

	let { onreset }: { onreset?: () => void } = $props();
	const app = useApp();
	const names = (app as { settingsPage?: { options: { groups: Record<string, string> } } })
		.settingsPage?.options.groups;
	const label = (group: Group) => names?.[group.id] ?? group.label;

	let step = $state<0 | 1 | 2>(0);
	let groups = $state.raw<Group[]>([]);
	const list = $derived(groups.map(label).join(', '));

	function start() {
		groups = app.lock?.sensitiveGroups() ?? [];
		step = 1;
	}

	function reset() {
		const cleared = app.lock?.reset() ?? [];
		step = 0;
		toast(
			app,
			cleared.length
				? `Lock reset. Cleared ${cleared.map(label).join(', ')}.`
				: 'Lock reset. Nothing else was cleared.'
		);
		onreset?.();
	}
</script>

<div class="flex flex-col gap-2" data-testid="lock-forgot">
	{#if step === 0}
		<button type="button" class="{ui.secondary} self-start" onclick={start}>Forgot passcode?</button
		>
	{:else}
		<div role="alert" class="flex flex-col gap-2 text-sm">
			{#if step === 1}
				<p>
					A passcode can't be recovered.
					{#if groups.length}
						Resetting turns the lock off and clears what it protects:
						<strong data-testid="lock-forgot-groups">{list}</strong>. Everything else stays.
					{:else}
						Resetting turns the lock off; nothing else is cleared.
					{/if}
				</p>
			{:else}
				<p>
					This can't be undone.
					{#if groups.length}Clear <strong>{list}</strong> and reset the lock?{:else}Reset the lock?{/if}
				</p>
			{/if}
			<div class="flex flex-wrap gap-2">
				{#if step === 1}
					<button type="button" class={ui.danger} onclick={() => (step = 2)}>Reset the lock</button>
				{:else}
					<button type="button" class={ui.danger} onclick={reset}>
						{groups.length ? 'Clear and reset' : 'Reset'}
					</button>
				{/if}
				<button type="button" class={ui.secondary} onclick={() => (step = 0)}>Cancel</button>
			</div>
		</div>
	{/if}
</div>
