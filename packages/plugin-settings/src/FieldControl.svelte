<script lang="ts">
	/** One settings field, drawn from its `control`: choice, switch, number or switches. */
	import type { FieldInfo } from '@xcwds/core';
	import { settings } from '@xcwds/sveltekit';

	let { field }: { field: FieldInfo } = $props();
	const uid = $props.id();
	const value = $derived(settings.current[field.name]);
	const set = (v: unknown) => settings.set({ [field.name]: v });
	/** `n` rounded to as many decimals as `step` has, so 0.1 steps don't drift. */
	const snap = (n: number, step: number) => {
		const places = (String(step).split('.')[1] ?? '').length;
		return Number(n.toFixed(Math.min(places, 20)));
	};

	const segment = (on: boolean) =>
		`relative flex min-h-11 cursor-pointer items-center justify-center rounded-xl px-3 py-2 text-center text-sm font-medium ${
			on
				? 'bg-(--xcwds-shell-accent) text-white'
				: 'bg-(--xcwds-shell-card) hover:bg-(--xcwds-shell-hover-bg)'
		}`;
	const small =
		'min-h-11 min-w-11 rounded-xl bg-(--xcwds-shell-card) px-3 font-medium hover:bg-(--xcwds-shell-hover-bg) disabled:opacity-40';
</script>

{#if field.control?.type === 'choice'}
	<fieldset class="flex flex-col gap-1">
		<legend class="font-medium">{field.label}</legend>
		{#if field.hint}<span class="text-sm text-(--xcwds-shell-muted)">{field.hint}</span>{/if}
		<div
			class="grid gap-2"
			style:grid-template-columns="repeat({field.control.options.length}, minmax(0, 1fr))"
		>
			{#each field.control.options as option, i (i)}
				<label
					class="{segment(
						value === option.value
					)} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--xcwds-shell-focus)"
				>
					<input
						type="radio"
						class="absolute inset-0 cursor-pointer appearance-none opacity-0"
						name="xcwds-setting-{uid}"
						checked={value === option.value}
						onchange={() => set(option.value)}
					/>{option.label}
				</label>
			{/each}
		</div>
	</fieldset>
{:else if field.control?.type === 'switch'}
	<label class="flex min-h-11 items-center justify-between gap-3">
		<span class="flex flex-col">
			<span class="font-medium">{field.label}</span>
			{#if field.hint}<span class="text-sm text-(--xcwds-shell-muted)">{field.hint}</span>{/if}
		</span>
		<input
			type="checkbox"
			role="switch"
			class="size-6 shrink-0"
			checked={value === true}
			onchange={(e) => set(e.currentTarget.checked)}
		/>
	</label>
{:else if field.control?.type === 'number'}
	{@const c = field.control}
	{@const n = typeof value === 'number' ? value : c.min}
	{@const step = c.step ?? 1}
	<div class="flex items-center justify-between gap-3">
		<span class="flex flex-col">
			<span class="font-medium">{field.label}</span>
			{#if field.hint}<span class="text-sm text-(--xcwds-shell-muted)">{field.hint}</span>{/if}
		</span>
		<div class="flex items-center gap-2">
			<button
				type="button"
				class={small}
				aria-label="Less {field.label}"
				disabled={n - step < c.min}
				onclick={() => set(Math.max(c.min, snap(n - step, step)))}
			>
				−
			</button>
			<output class="min-w-14 text-center text-lg tabular-nums" aria-live="polite">
				{n}{c.unit ? ` ${c.unit}` : ''}
			</output>
			<button
				type="button"
				class={small}
				aria-label="More {field.label}"
				disabled={n + step > c.max}
				onclick={() => set(Math.min(c.max, snap(n + step, step)))}
			>
				+
			</button>
		</div>
	</div>
{:else if field.control?.type === 'switches'}
	{@const current = (typeof value === 'object' && value !== null ? value : {}) as Record<
		string,
		unknown
	>}
	<fieldset class="flex flex-col gap-1">
		<legend class="sr-only">{field.label}</legend>
		{#each field.control.options as option (option.key)}
			<label class="flex min-h-11 items-center justify-between gap-3">
				<span class="flex flex-col">
					<span class="font-medium">{option.label}</span>
					{#if option.hint}<span class="text-sm text-(--xcwds-shell-muted)">
							{option.hint}
						</span>{/if}
				</span>
				<input
					type="checkbox"
					role="switch"
					class="size-6 shrink-0"
					checked={current[option.key] === true}
					onchange={(e) => set({ ...current, [option.key]: e.currentTarget.checked })}
				/>
			</label>
		{/each}
	</fieldset>
{/if}
