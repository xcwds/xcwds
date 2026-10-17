<script lang="ts">
	/** A notes block: one plain-text area, saved as you type. */
	import type { NotesData } from '../data.js';
	import { LIMITS, type NotesBlock } from '../format.js';
	import { textarea } from '../ui.js';
	import type { UpdateBlock } from './types.js';

	let {
		block,
		data,
		update
	}: {
		block: NotesBlock;
		data: NotesData | undefined;
		update: UpdateBlock<NotesData>;
	} = $props();

	let text = $state('');
	/** The text last saved or loaded here, so another tab's change shows but this tab's doesn't jump. */
	let known: string | undefined;
	$effect.pre(() => {
		const saved = data?.text ?? '';
		if (saved !== known) {
			known = saved;
			text = saved;
		}
	});

	let timer: ReturnType<typeof setTimeout> | undefined;
	/** The block's `update` when the text was typed, so a late save goes where it was typed. */
	let target: UpdateBlock<NotesData> | undefined;
	function save() {
		clearTimeout(timer);
		timer = undefined;
		const to = target ?? update;
		target = undefined;
		if (text === known) return;
		const next = text;
		if (to(() => ({ text: next }))) known = next;
	}
	function typed() {
		clearTimeout(timer);
		target = update;
		timer = setTimeout(save, 500);
	}
	$effect(() => () => {
		if (timer) save();
	});
</script>

<label class="flex flex-col gap-1">
	<span class="sr-only">{block.label}</span>
	<textarea
		class="{textarea} text-base"
		rows="5"
		maxlength={LIMITS.notes}
		bind:value={text}
		oninput={typed}
		onblur={save}></textarea>
</label>
