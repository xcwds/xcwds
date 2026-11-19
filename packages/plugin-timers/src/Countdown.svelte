<script lang="ts">
	/** One timer's remaining time as m:ss (or "Done"), updating while it runs. */
	import { useApp } from '@xcwds/sveltekit';
	import { formatDuration } from './timer.js';
	import type {} from './client.js';

	let { id, class: className = '' }: { id: number; class?: string } = $props();

	const timers = useApp().timers;
	let text = $state('');
	let label = $state('');
	$effect(() =>
		timers?.subscribe(() => {
			const item = timers.get(id);
			label = item?.label ?? '';
			text = !item ? '' : timers.ringing(item) ? 'Done' : formatDuration(timers.remaining(item));
		})
	);
</script>

<span class="font-mono tabular-nums {className}" role="timer" aria-label="{label} remaining">
	{text}
</span>
