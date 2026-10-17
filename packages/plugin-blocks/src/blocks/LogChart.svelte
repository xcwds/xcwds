<script lang="ts">
	/**
	 * A number or scale field's chart over the last 7, 30 or 90 days: an inline SVG line (no
	 * library), its text summary (latest, average, lowest, highest) under it and as its label, and
	 * "Show as table" for the numbers themselves.
	 */
	import type { LogField } from '../format.js';
	import { RANGES, series, summarize, summaryText, type LogData } from '../log.js';
	import { button, muted } from '../ui.js';
	import { chartPoints, chartRange, valueText, whenText } from '../view.js';

	let { field, data, now }: { field: LogField; data: LogData | undefined; now: number } = $props();

	let days = $state<number>(RANGES[0]);
	let table = $state(false);

	const box = { width: 320, height: 120, pad: 8 };
	const points = $derived(series(data ?? { entries: [] }, field.id, days, now));
	const summary = $derived(summaryText(field, summarize(points), days));
	const range = $derived(
		chartRange(
			field,
			points.map((p) => p.value)
		)
	);
	const placed = $derived(chartPoints(points, days, now, range, box));
</script>

<div class="flex flex-col gap-2" data-testid="log-chart" data-field={field.id}>
	<div class="flex flex-wrap items-center gap-2">
		<span class="font-medium">{field.label}</span>
		<div class="ml-auto flex gap-1" role="group" aria-label="Days shown: {field.label}">
			{#each RANGES as n (n)}
				<button
					type="button"
					class="{button} px-3 text-sm"
					class:ring-2={days === n}
					class:ring-(--xcwds-shell-accent)={days === n}
					aria-pressed={days === n}
					onclick={() => (days = n)}>{n} days</button
				>
			{/each}
		</div>
	</div>
	{#if placed.length}
		<svg
			viewBox="0 0 {box.width} {box.height}"
			class="h-auto w-full rounded-xl border border-(--xcwds-shell-border)"
			role="img"
			aria-label={summary}
		>
			{#if placed.length > 1}
				<polyline
					points={placed.map((p) => `${p.x},${p.y}`).join(' ')}
					fill="none"
					stroke="var(--xcwds-shell-accent)"
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
				/>
			{/if}
			{#each placed as p, i (i)}
				<circle cx={p.x} cy={p.y} r="3" fill="var(--xcwds-shell-accent)" />
			{/each}
		</svg>
	{/if}
	<p class={muted} data-testid="log-summary">{summary}</p>
	{#if points.length}
		<button
			type="button"
			class="{button} self-start text-sm"
			aria-expanded={table}
			onclick={() => (table = !table)}>{table ? 'Hide table' : 'Show as table'}</button
		>
		{#if table}
			<table class="text-sm">
				<caption class="sr-only">{field.label}, last {days} days</caption>
				<thead>
					<tr
						><th class="pr-4 text-left font-medium">When</th><th class="text-left font-medium"
							>{field.label}</th
						></tr
					>
				</thead>
				<tbody>
					{#each [...points].reverse() as p, i (i)}
						<tr><td class="pr-4">{whenText(p.at, now)}</td><td>{valueText(field, p.value)}</td></tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{/if}
</div>
