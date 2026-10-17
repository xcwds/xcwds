<script lang="ts">
	/** A checklist block: tick items off; a repeating one unticks itself when it's due again. */
	import { dayKey } from '../calendar.js';
	import { isTicked, nextDue, progress, tick, type ChecklistData } from '../checklist.js';
	import type { ChecklistBlock } from '../format.js';
	import { muted } from '../ui.js';
	import { dueText, repeatText } from '../view.js';
	import type { UpdateBlock } from './types.js';

	let {
		block,
		data,
		now,
		update
	}: {
		block: ChecklistBlock;
		data: ChecklistData | undefined;
		now: number;
		update: UpdateBlock<ChecklistData>;
	} = $props();

	const saved = $derived(data ?? { done: {} });
	const today = $derived(dayKey(now));
	const count = $derived(progress(block, saved, today));

	function toggle(event: Event & { currentTarget: HTMLInputElement }, id: string) {
		const box = event.currentTarget;
		const item = block.items.find((i) => i.id === id);
		if (!item) return;
		const ticked = box.checked;
		// Not saved: the box shows what is.
		if (!update((current) => tick(current ?? { done: {} }, item, ticked, today)))
			box.checked = !ticked;
	}
</script>

<div class="flex flex-col gap-2">
	<p class={muted} data-testid="checklist-progress">{count.done} of {count.total} done</p>
	<ul class="flex flex-col">
		{#each block.items as item (item.id)}
			{@const ticked = isTicked(item, saved, today)}
			{@const repeat = repeatText(item)}
			{@const due = ticked && saved.done[item.id] ? nextDue(item, saved.done[item.id]!) : null}
			<li>
				<label class="flex min-h-11 cursor-pointer items-center gap-3 py-1">
					<input
						type="checkbox"
						class="size-5 shrink-0 accent-(--xcwds-shell-accent)"
						checked={ticked}
						onchange={(e) => toggle(e, item.id)}
					/>
					<span class="flex flex-col">
						<span class:line-through={ticked} class:opacity-60={ticked}>{item.label}</span>
						{#if repeat}
							<span class={muted}>{repeat}{due ? ` · ${dueText(due, today)}` : ''}</span>
						{/if}
					</span>
				</label>
			</li>
		{/each}
	</ul>
</div>
