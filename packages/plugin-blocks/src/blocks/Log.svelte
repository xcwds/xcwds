<script lang="ts">
	/**
	 * A log block: a form that adds a timestamped entry, a chart for each number or scale field,
	 * and the entries, newest first, each editable (in the same form, keeping its time) and
	 * deletable with Undo.
	 */
	import { newId, LIMITS, type LogBlock } from '../format.js';
	import {
		addEntry,
		parseValues,
		removeEntry,
		updateEntry,
		type LogData,
		type LogEntry
	} from '../log.js';
	import { button, card, field, muted, primary } from '../ui.js';
	import { valueText, whenText } from '../view.js';
	import LogChart from './LogChart.svelte';
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

	/** The entry the form is editing, by id; null when it adds a new one. */
	let editing = $state<string | null>(null);
	let formElement = $state<HTMLFormElement>();
	const charted = $derived(block.fields.filter((f) => f.type === 'number' || f.type === 'scale'));

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const parsed = parseValues(block, values());
		if (!parsed.ok) {
			error = parsed.error;
			return;
		}
		const id = editing;
		const saved = update((current) => {
			const latest = current ?? { entries: [] };
			const before = id ? latest.entries.find((e) => e.id === id) : undefined;
			// Edited: same id and time. Gone meanwhile (another tab deleted it): added back as edited.
			if (before) return updateEntry(latest, { ...before, values: parsed.value });
			return addEntry(latest, { id: id ?? newId(), at: Date.now(), values: parsed.value });
		});
		if (!saved) return;
		reset();
	}

	function reset() {
		error = '';
		form = {};
		editing = null;
	}

	/** Puts an entry's values in the form, as its inputs hold them. */
	function edit(entry: LogEntry) {
		const next: typeof form = {};
		for (const f of block.fields) {
			const v = entry.values[f.id];
			if (v === undefined) continue;
			if (f.type === 'number') next[f.id] = v as number;
			else if (f.type === 'yesno') next[f.id] = v ? 'yes' : 'no';
			else next[f.id] = String(v);
		}
		form = next;
		error = '';
		editing = entry.id;
		formElement?.scrollIntoView({ block: 'nearest' });
		formElement?.querySelector<HTMLElement>('input, select')?.focus();
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
		if (editing === id) reset();
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
	<form
		bind:this={formElement}
		class="{card} flex flex-col gap-3"
		onsubmit={submit}
		novalidate
		data-testid="log-form"
	>
		{#if editing}
			{@const entry = entries.find((e) => e.id === editing)}
			<p class="text-sm font-medium" data-testid="log-editing">
				Editing the entry from {entry ? whenText(entry.at, now) : 'earlier'}
			</p>
		{/if}
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
		<div class="flex gap-2">
			<button type="submit" class={primary}>{editing ? 'Save changes' : 'Add entry'}</button>
			{#if editing}
				<button type="button" class={button} onclick={reset}>Cancel</button>
			{/if}
		</div>
	</form>

	{#each charted as f (f.id)}
		<LogChart field={f} {data} {now} />
	{/each}

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
					<div class="flex flex-col gap-2">
						<button
							type="button"
							class={button}
							aria-label="Edit the entry from {when}"
							onclick={() => edit(entry)}>Edit</button
						>
						<button
							type="button"
							class={button}
							aria-label="Delete the entry from {when}"
							onclick={() => remove(entry.id)}>Delete</button
						>
					</div>
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
