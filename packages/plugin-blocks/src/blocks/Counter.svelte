<script lang="ts">
	/** A counter block: + and −, an optional goal, and the past days or weeks it reset from. */
	import { adjust, current, type CounterData } from '../counter.js';
	import type { CounterBlock } from '../format.js';
	import { button, muted } from '../ui.js';
	import { periodText } from '../view.js';
	import type { UpdateBlock } from './types.js';

	let {
		block,
		data,
		now,
		update
	}: {
		block: CounterBlock;
		data: CounterData | undefined;
		now: number;
		update: UpdateBlock<CounterData>;
	} = $props();

	const empty = (): CounterData => ({ period: 'all', value: 0, history: [] });
	const shown = $derived(current(block, data ?? empty(), now));
	const unit = $derived(block.unit ? ` ${block.unit}` : '');
	const reached = $derived(block.goal !== undefined && shown.value >= block.goal);
	/** Past periods shown under the count. */
	const PAST = 14;

	const change = (delta: number) =>
		update((saved) => adjust(block, saved ?? empty(), delta, Date.now()));
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center gap-3">
		<button
			type="button"
			class="{button} min-w-14 text-2xl"
			aria-label="One less: {block.label}"
			disabled={shown.value === 0}
			onclick={() => change(-1)}>−</button
		>
		<p class="flex-1 text-center" aria-live="polite" data-testid="counter-value">
			<span class="text-4xl font-semibold tabular-nums">{shown.value}</span>
			{#if block.goal !== undefined}
				<span class="text-lg text-(--xcwds-shell-muted)">/ {block.goal}</span>
			{/if}{#if unit}<span class="text-lg text-(--xcwds-shell-muted)">{unit}</span>{/if}
		</p>
		<button
			type="button"
			class="{button} min-w-14 text-2xl"
			aria-label="One more: {block.label}"
			onclick={() => change(1)}>+</button
		>
	</div>
	{#if reached}
		<p class="text-center text-sm font-medium" data-testid="counter-goal">Goal reached</p>
	{/if}
	{#if shown.history.length}
		<details class="text-sm">
			<summary class="flex min-h-11 cursor-pointer items-center"
				>{block.reset === 'weekly' ? 'Past weeks' : 'Past days'}</summary
			>
			<ul class="flex flex-col gap-1">
				{#each shown.history.slice(0, PAST) as past (past.period)}
					<li class="flex justify-between gap-3">
						<span class={muted}>{periodText(past.period, block.reset === 'weekly')}</span>
						<span class="tabular-nums">{past.value}{unit}</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</div>
