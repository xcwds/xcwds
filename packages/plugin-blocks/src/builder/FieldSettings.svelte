<script lang="ts">
	/**
	 * One log field in the builder: its label, its type, and what that type takes (a number's
	 * unit and limits, a scale's top and end words, a choice's options). Changing the type keeps
	 * the field's id and label, so `dataLoss` sees it as a type change.
	 */
	import { blankField } from '../edit.js';
	import { LIMITS, newId, type LogField } from '../format.js';
	import { button, field as input, muted } from '../ui.js';
	import { FIELD_TYPES, setNumber } from './types.js';

	let {
		field = $bindable(),
		index,
		count,
		onmove,
		onremove
	}: {
		field: LogField;
		index: number;
		count: number;
		onmove: (by: number) => void;
		onremove: () => void;
	} = $props();

	const id = (part: string) => `field-${field.id}-${part}`;

	function changeType(type: LogField['type']) {
		field = { ...blankField(type), id: field.id, label: field.label } as LogField;
	}
</script>

<fieldset class="flex flex-col gap-3 rounded-xl border border-(--xcwds-shell-border) p-3">
	<legend class="px-1 text-sm font-medium">Field {index + 1}: {field.label || 'no label'}</legend>
	<div class="grid gap-3 sm:grid-cols-2">
		<label class="flex flex-col gap-1" for={id('label')}>
			<span class="text-sm">Label</span>
			<input
				id={id('label')}
				class={input}
				maxlength={LIMITS.label}
				bind:value={field.label}
				autocomplete="off"
			/>
		</label>
		<label class="flex flex-col gap-1" for={id('type')}>
			<span class="text-sm">Type</span>
			<select
				id={id('type')}
				class={input}
				value={field.type}
				onchange={(e) => changeType(e.currentTarget.value as LogField['type'])}
			>
				{#each FIELD_TYPES as [type, name] (type)}
					<option value={type}>{name}</option>
				{/each}
			</select>
		</label>
	</div>

	{#if field.type === 'number'}
		<div class="grid grid-cols-3 gap-3">
			<label class="flex flex-col gap-1" for={id('unit')}>
				<span class="text-sm">Unit</span>
				<input
					id={id('unit')}
					class={input}
					maxlength={LIMITS.unit}
					bind:value={field.unit}
					autocomplete="off"
				/>
			</label>
			<label class="flex flex-col gap-1" for={id('min')}>
				<span class="text-sm">Lowest</span>
				<input
					id={id('min')}
					type="number"
					inputmode="decimal"
					class={input}
					value={field.min ?? ''}
					oninput={(e) => setNumber(field, 'min', e.currentTarget.value)}
				/>
			</label>
			<label class="flex flex-col gap-1" for={id('max')}>
				<span class="text-sm">Highest</span>
				<input
					id={id('max')}
					type="number"
					inputmode="decimal"
					class={input}
					value={field.max ?? ''}
					oninput={(e) => setNumber(field, 'max', e.currentTarget.value)}
				/>
			</label>
		</div>
	{:else if field.type === 'scale'}
		<div class="grid grid-cols-3 gap-3">
			<label class="flex flex-col gap-1" for={id('top')}>
				<span class="text-sm">From 1 to</span>
				<select
					id={id('top')}
					class={input}
					value={String(field.max)}
					onchange={(e) => {
						if (field.type === 'scale') field.max = e.currentTarget.value === '10' ? 10 : 5;
					}}
				>
					<option value="5">5</option>
					<option value="10">10</option>
				</select>
			</label>
			<label class="flex flex-col gap-1" for={id('low')}>
				<span class="text-sm">1 means</span>
				<input
					id={id('low')}
					class={input}
					maxlength={LIMITS.label}
					bind:value={field.low}
					autocomplete="off"
				/>
			</label>
			<label class="flex flex-col gap-1" for={id('high')}>
				<span class="text-sm">{field.max} means</span>
				<input
					id={id('high')}
					class={input}
					maxlength={LIMITS.label}
					bind:value={field.high}
					autocomplete="off"
				/>
			</label>
		</div>
	{:else if field.type === 'choice'}
		<div class="flex flex-col gap-2">
			<p class={muted}>Options ({field.options.length} of {LIMITS.choiceOptions})</p>
			<ul class="flex flex-col gap-2">
				{#each field.options as option, i (option.id)}
					<li class="flex items-center gap-2">
						<input
							class="{input} min-w-0 flex-1"
							aria-label="Option {i + 1}"
							maxlength={LIMITS.label}
							bind:value={option.label}
							autocomplete="off"
						/>
						<button
							type="button"
							class={button}
							disabled={field.options.length <= 1}
							aria-label="Remove option {i + 1}"
							onclick={() => {
								if (field.type === 'choice')
									field.options = field.options.filter((o) => o.id !== option.id);
							}}>Remove</button
						>
					</li>
				{/each}
			</ul>
			<button
				type="button"
				class="{button} self-start"
				disabled={field.options.length >= LIMITS.choiceOptions}
				onclick={() => {
					if (field.type === 'choice')
						field.options = [
							...field.options,
							{ id: newId(), label: `Option ${field.options.length + 1}` }
						];
				}}>Add option</button
			>
		</div>
	{/if}

	<div class="flex flex-wrap gap-2">
		<button
			type="button"
			class={button}
			disabled={index === 0}
			aria-label="Move field {index + 1} up"
			onclick={() => onmove(-1)}>Move up</button
		>
		<button
			type="button"
			class={button}
			disabled={index === count - 1}
			aria-label="Move field {index + 1} down"
			onclick={() => onmove(1)}>Move down</button
		>
		<button
			type="button"
			class={button}
			disabled={count <= 1}
			aria-label="Remove field {index + 1}"
			onclick={onremove}>Remove</button
		>
	</div>
</fieldset>
