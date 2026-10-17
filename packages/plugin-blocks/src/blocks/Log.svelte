<script lang="ts">
	/**
	 * A log block: a form that adds a timestamped entry, and the entries, newest first, each
	 * deletable with Undo.
	 */
	import { newId, LIMITS, type LogBlock } from '../format.js';
	import { addEntry, parseValues, removeEntry, type LogData, type LogEntry } from '../log.js';
	import { button, card, field, muted, primary } from '../ui.js';
	import { valueText, whenText } from '../view.js';
	import type { UpdateBlock } from './types.js';

	let {
		block,
		data,
		now,
		update
	}: {
		block: LogBlock;
		data: LogData | undefined;
		now: number;
		update: UpdateBlock<LogData>;
	} = $props();

	const entries = $derived(data?.entries ?? []);
	/** Entries shown; "Show more" adds this many. */
	const PAGE = 20;
	let shown = $state(PAGE);

	/** What's typed or chosen, by field id, as the inputs hold it (a number input gives numbers). */
	let form = $state<Record<string, string | number | null | undefined>>({});
	let error = $state('');

	/** The form's values as `parseValues` reads them. */
	function values(): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const f of block.fields) {
			const raw = form[f.id];
			if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === ''))
				continue;
			if (f.type === 'number' || f.type === 'scale') out[f.id] = Number(raw);
			else if (f.type === 'yesno') out[f.id] = raw === 'yes';
			else out[f.id] = String(raw);
		}
		return out;
	}

	function add(event: SubmitEvent) {
		event.preventDefault();
		const parsed = parseValues(block, values());
		if (!parsed.ok) {
			error = parsed.error;
			return;
		}
		const entry: LogEntry = { id: newId(), at: Date.now(), values: parsed.value };
		if (!update((saved) => addEntry(saved ?? { entries: [] }, entry))) return;
		error = '';
		form = {};
	}

	/** The last deleted entry, until Undo times out. */
	let undo = $state.raw<{ entry: LogEntry; timer: ReturnType<typeof setTimeout> } | null>(null);

	function remove(id: string) {
		let removed: LogEntry | undefined;
		const saved = update((current) => {
			const result = removeEntry(current ?? { entries: [] }, id);
			removed = result.removed;
			return result.data;
		});
		if (!saved || !removed) return;
		if (undo) clearTimeout(undo.timer);
		undo = { entry: removed, timer: setTimeout(() => (undo = null), 8000) };
	}

	function restore() {
		if (!undo) return;
		const { entry, timer } = undo;
		clearTimeout(timer);
		undo = null;
		update((current) => addEntry(current ?? { entries: [] }, entry));
	}

	$effect(() => () => {
		if (undo) clearTimeout(undo.timer);
	});

	const label = (id: string) => `${block.id}-${id}`;
</script>

<div class="flex flex-col gap-4">
	<form class="{card} flex flex-col gap-3" onsubmit={add} novalidate>
		{#each block.fields as f (f.id)}
			{#if f.type === 'scale'}
				<fieldset class="flex flex-col gap-1">
					<legend class="mb-1 text-sm">{f.label}</legend>
					<div class="grid grid-cols-5 gap-1">
						{#each Array.from({ length: f.max }, (_, i) => String(i + 1)) as n (n)}
							<label class="relative">
								<input
									type="radio"
									name={label(f.id)}
									value={n}
									class="peer sr-only"
									bind:group={form[f.id]}
								/>
								<span
									class="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-(--xcwds-shell-border) peer-checked:bg-(--xcwds-shell-accent) peer-checked:text-(--xcwds-shell-bg) peer-focus-visible:outline-2 peer-focus-visible:outline-(--xcwds-shell-focus)"
									>{n}</span
								>
							</label>
						{/each}
					</div>
					{#if f.low || f.high}
						<p class="flex justify-between {muted}">
							<span>1: {f.low ?? ''}</span><span>{f.max}: {f.high ?? ''}</span>
						</p>
					{/if}
				</fieldset>
			{:else if f.type === 'yesno'}
				<fieldset class="flex flex-col gap-1">
					<legend class="mb-1 text-sm">{f.label}</legend>
					<div class="grid grid-cols-2 gap-1">
						{#each [['yes', 'Yes'], ['no', 'No']] as [value, text] (value)}
							<label class="relative">
								<input
									type="radio"
									name={label(f.id)}
									{value}
									class="peer sr-only"
									bind:group={form[f.id]}
								/>
								<span
									class="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-(--xcwds-shell-border) peer-checked:bg-(--xcwds-shell-accent) peer-checked:text-(--xcwds-shell-bg) peer-focus-visible:outline-2 peer-focus-visible:outline-(--xcwds-shell-focus)"
									>{text}</span
								>
							</label>
						{/each}
					</div>
				</fieldset>
			{:else}
				<label class="flex flex-col gap-1 text-sm">
					{f.label}{f.type === 'number' && f.unit ? ` (${f.unit})` : ''}
					{#if f.type === 'number'}
						<input
							type="number"
							inputmode="decimal"
							step="any"
							min={f.min}
							max={f.max}
							class="{field} text-base"
							bind:value={form[f.id]}
						/>
					{:else if f.type === 'choice'}
						<select class="{field} text-base" bind:value={form[f.id]}>
							<option value="">Choose…</option>
							{#each f.options as option (option.id)}
								<option value={option.id}>{option.label}</option>
							{/each}
						</select>
					{:else if f.type === 'time'}
						<input type="time" class="{field} text-base" bind:value={form[f.id]} />
					{:else}
						<input
							type="text"
							maxlength={LIMITS.text}
							class="{field} text-base"
							bind:value={form[f.id]}
						/>
					{/if}
				</label>
			{/if}
		{/each}
		{#if error}
			<p class="text-sm text-red-700 dark:text-red-400" role="alert">{error}</p>
		{/if}
		<button type="submit" class="{primary} self-start">Add entry</button>
	</form>

	{#if entries.length}
		<ul class="flex flex-col gap-2" aria-label="Entries: {block.label}">
			{#each entries.slice(0, shown) as entry (entry.id)}
				{@const when = whenText(entry.at, now)}
				<li class="{card} flex items-start gap-3" data-testid="log-entry">
					<div class="flex min-w-0 flex-1 flex-col gap-1">
						<p class={muted}>{when}</p>
						<dl class="flex flex-col gap-0.5">
							{#each block.fields as f (f.id)}
								{#if entry.values[f.id] !== undefined}
									<div class="flex gap-2">
										<dt class="text-(--xcwds-shell-muted)">{f.label}</dt>
										<dd class="min-w-0 break-words">{valueText(f, entry.values[f.id]!)}</dd>
									</div>
								{/if}
							{/each}
						</dl>
					</div>
					<button
						type="button"
						class={button}
						aria-label="Delete the entry from {when}"
						onclick={() => remove(entry.id)}>Delete</button
					>
				</li>
			{/each}
		</ul>
		{#if entries.length > shown}
			<button type="button" class="{button} self-start" onclick={() => (shown += PAGE)}
				>Show more</button
			>
		{/if}
	{:else}
		<p class={muted}>No entries yet.</p>
	{/if}
	<p class="flex min-h-11 items-center gap-3 text-sm" aria-live="polite">
		{#if undo}
			Entry deleted.
			<button type="button" class={button} onclick={restore}>Undo</button>
		{/if}
	</p>
</div>
