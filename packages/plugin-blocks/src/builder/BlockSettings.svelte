<script lang="ts">
	/**
	 * One block's settings in the builder: its label, and a checklist's items and repeats, a
	 * counter's goal, unit and reset, or a log's fields. Removing a field calls `onremoved` with
	 * a way to put it back, for the builder's Undo.
	 */
	import { blankField, move } from '../edit.js';
	import { LIMITS, newId, type Block, type ChecklistItem, type Repeat } from '../format.js';
	import { button, field as input, muted } from '../ui.js';
	import FieldSettings from './FieldSettings.svelte';
	import { setNumber } from './types.js';

	let {
		block = $bindable(),
		onremoved
	}: {
		block: Block;
		onremoved: (label: string, restore: () => void) => void;
	} = $props();

	const id = (part: string) => `block-${block.id}-${part}`;

	/** Monday first, as weeks run here; values are `Date#getDay()` numbers. */
	const WEEKDAYS: [number, string][] = [
		[1, 'Mon'],
		[2, 'Tue'],
		[3, 'Wed'],
		[4, 'Thu'],
		[5, 'Fri'],
		[6, 'Sat'],
		[0, 'Sun']
	];

	function setRepeat(item: ChecklistItem, kind: string) {
		const next: Repeat | undefined =
			kind === 'daily'
				? { repeat: 'daily' }
				: kind === 'weekly'
					? { repeat: 'weekly', weekdays: [1] }
					: kind === 'every'
						? { repeat: 'every', days: 2 }
						: undefined;
		if (next) item.repeat = next;
		else delete item.repeat;
	}

	function toggleDay(item: ChecklistItem, day: number, on: boolean) {
		if (item.repeat?.repeat !== 'weekly') return;
		const days = item.repeat.weekdays.filter((d) => d !== day);
		item.repeat.weekdays = on ? [...days, day] : days;
	}

	function removeItem(index: number) {
		if (block.type !== 'checklist') return;
		block.items = block.items.filter((_, i) => i !== index);
	}

	function removeField(index: number) {
		if (block.type !== 'log') return;
		const removed = block.fields[index];
		if (!removed) return;
		block.fields = block.fields.filter((_, i) => i !== index);
		onremoved(removed.label || 'the field', () => {
			if (block.type !== 'log' || block.fields.some((f) => f.id === removed.id)) return;
			const fields = [...block.fields];
			fields.splice(Math.min(index, fields.length), 0, removed);
			block.fields = fields;
		});
	}
</script>

<div class="flex flex-col gap-4">
	<label class="flex flex-col gap-1" for={id('label')}>
		<span class="text-sm">Heading</span>
		<input
			id={id('label')}
			class={input}
			maxlength={LIMITS.label}
			bind:value={block.label}
			autocomplete="off"
		/>
	</label>

	{#if block.type === 'checklist'}
		<div class="flex flex-col gap-2">
			<p class={muted}>Items ({block.items.length} of {LIMITS.checklistItems})</p>
			<ul class="flex flex-col gap-3">
				{#each block.items as item, i (item.id)}
					{@const kind = item.repeat?.repeat ?? 'once'}
					<li class="flex flex-col gap-2 rounded-xl border border-(--xcwds-shell-border) p-3">
						<div class="grid gap-2 sm:grid-cols-2">
							<input
								class={input}
								aria-label="Item {i + 1}"
								maxlength={LIMITS.label}
								bind:value={item.label}
								autocomplete="off"
							/>
							<select
								class={input}
								aria-label="Item {i + 1} repeats"
								value={kind}
								onchange={(e) => setRepeat(item, e.currentTarget.value)}
							>
								<option value="once">Doesn't repeat</option>
								<option value="daily">Every day</option>
								<option value="weekly">On chosen days</option>
								<option value="every">Every few days</option>
							</select>
						</div>
						{#if item.repeat?.repeat === 'weekly'}
							{@const weekdays = item.repeat.weekdays}
							<fieldset class="flex flex-wrap gap-1">
								<legend class="sr-only">Days for item {i + 1}</legend>
								{#each WEEKDAYS as [day, name] (day)}
									<label
										class="flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-lg bg-(--xcwds-shell-card) px-2 text-sm"
									>
										<input
											type="checkbox"
											class="accent-(--xcwds-shell-accent)"
											checked={weekdays.includes(day)}
											disabled={weekdays.length === 1 && weekdays.includes(day)}
											onchange={(e) => toggleDay(item, day, e.currentTarget.checked)}
										/>
										{name}
									</label>
								{/each}
							</fieldset>
						{:else if item.repeat?.repeat === 'every'}
							<label class="flex items-center gap-2 text-sm">
								Every
								<input
									type="number"
									inputmode="numeric"
									min="1"
									max={LIMITS.everyDays}
									class="{input} w-24"
									aria-label="Days between, item {i + 1}"
									value={item.repeat.days}
									oninput={(e) => {
										// Only a whole number from 1 counts; while the box is cleared to retype, the
										// days stay as they were.
										const days = Number(e.currentTarget.value);
										if (item.repeat?.repeat === 'every' && Number.isInteger(days) && days >= 1)
											item.repeat.days = days;
									}}
									onchange={(e) => {
										if (item.repeat?.repeat === 'every')
											e.currentTarget.value = String(item.repeat.days);
									}}
								/>
								days
							</label>
						{/if}
						<div class="flex flex-wrap gap-2">
							<button
								type="button"
								class={button}
								disabled={i === 0}
								aria-label="Move item {i + 1} up"
								onclick={() => {
									if (block.type === 'checklist') block.items = move(block.items, i, -1);
								}}>Move up</button
							>
							<button
								type="button"
								class={button}
								disabled={i === block.items.length - 1}
								aria-label="Move item {i + 1} down"
								onclick={() => {
									if (block.type === 'checklist') block.items = move(block.items, i, 1);
								}}>Move down</button
							>
							<button
								type="button"
								class={button}
								aria-label="Remove item {i + 1}"
								onclick={() => removeItem(i)}>Remove</button
							>
						</div>
					</li>
				{/each}
			</ul>
			<button
				type="button"
				class="{button} self-start"
				disabled={block.items.length >= LIMITS.checklistItems}
				onclick={() => {
					if (block.type === 'checklist')
						block.items = [
							...block.items,
							{ id: newId(), label: `Item ${block.items.length + 1}` }
						];
				}}>Add item</button
			>
		</div>
	{:else if block.type === 'counter'}
		<div class="grid grid-cols-3 gap-3">
			<label class="flex flex-col gap-1" for={id('goal')}>
				<span class="text-sm">Goal</span>
				<input
					id={id('goal')}
					type="number"
					inputmode="numeric"
					min="1"
					class={input}
					value={block.goal ?? ''}
					oninput={(e) => setNumber(block, 'goal', e.currentTarget.value)}
				/>
			</label>
			<label class="flex flex-col gap-1" for={id('unit')}>
				<span class="text-sm">Unit</span>
				<input
					id={id('unit')}
					class={input}
					maxlength={LIMITS.unit}
					bind:value={block.unit}
					autocomplete="off"
				/>
			</label>
			<label class="flex flex-col gap-1" for={id('reset')}>
				<span class="text-sm">Starts again</span>
				<select id={id('reset')} class={input} bind:value={block.reset}>
					<option value="never">Never</option>
					<option value="daily">Each day</option>
					<option value="weekly">Each week</option>
				</select>
			</label>
		</div>
	{:else if block.type === 'log'}
		<div class="flex flex-col gap-3">
			<p class={muted}>Fields ({block.fields.length} of {LIMITS.fields})</p>
			{#each block.fields as f, i (f.id)}
				<FieldSettings
					bind:field={block.fields[i]!}
					index={i}
					count={block.fields.length}
					onmove={(by) => {
						if (block.type === 'log') block.fields = move(block.fields, i, by);
					}}
					onremove={() => removeField(i)}
				/>
			{/each}
			<button
				type="button"
				class="{button} self-start"
				disabled={block.fields.length >= LIMITS.fields}
				onclick={() => {
					if (block.type === 'log') block.fields = [...block.fields, blankField('number')];
				}}>Add field</button
			>
		</div>
	{/if}
</div>
