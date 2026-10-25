<script lang="ts">
	/**
	 * What `<NotionView>` shows under a copy with the `writes` option (#109): "Add a note", the
	 * changes to this source still waiting to be sent (with why Notion refused one, Retry and
	 * Discard), and the ticks Notion had the other way. `blocks` is the copy's, to name the to-dos.
	 */
	import type { AppNotion, NotionConflict, OutboxItem } from './client.js';
	import type { Block } from './document.js';
	import {
		NOTE_PARAGRAPHS,
		describeChange,
		failureMessage,
		noteParagraphs,
		todoName
	} from './outbox.js';

	let {
		notion,
		source,
		blocks,
		outbox,
		conflicts,
		sending,
		connected
	}: {
		notion: AppNotion;
		source: string;
		blocks: readonly Block[];
		outbox: OutboxItem[];
		conflicts: NotionConflict[];
		sending: boolean;
		connected: boolean;
	} = $props();

	const button =
		'min-h-11 rounded-xl border border-current/20 px-4 font-medium hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10';

	let note = $state('');
	let noteError = $state('');
	function addNote(event: SubmitEvent) {
		event.preventDefault();
		if (!note.trim()) return;
		if (!noteParagraphs(note))
			return void (noteError = `That note is too long to send: at most ${NOTE_PARAGRAPHS} paragraphs.`);
		if (!notion.change(source, { kind: 'note', text: note }))
			return void (noteError = 'The note couldn’t be saved on this device.');
		note = '';
		noteError = '';
	}

	const ticked = (checked: boolean) => (checked ? 'ticked' : 'not ticked');
</script>

<div class="flex flex-col gap-4" data-testid="notion-changes">
	{#if conflicts.length}
		<div class="flex flex-col gap-2 rounded-xl border border-current/20 p-3" role="status">
			{#each conflicts as conflict (conflict.item.id)}
				{@const item = conflict.item}
				<p data-testid="notion-conflict">
					The to-do {item.kind === 'check' ? todoName(blocks, item.block) : ''} was changed in Notion
					since this copy was downloaded, so Notion’s stays: {ticked(conflict.checked)}.
				</p>
			{/each}
			<button type="button" class="{button} self-start" onclick={() => notion.clearConflicts()}
				>Dismiss</button
			>
		</div>
	{/if}

	<form class="flex flex-col gap-2" onsubmit={addNote}>
		<label class="flex flex-col gap-1">
			Add a note
			<textarea
				class="min-h-11 rounded-xl border border-current/20 bg-transparent p-2"
				rows="3"
				bind:value={note}
				oninput={() => (noteError = '')}></textarea>
		</label>
		<p class="text-sm opacity-70">Added at the end of the page in Notion, as plain text.</p>
		<button class="{button} self-start" disabled={!note.trim()}>Add note</button>
		<p data-testid="notion-note-error" role="status" class="empty:hidden">{noteError}</p>
	</form>

	{#if outbox.length}
		<section class="flex flex-col gap-2" aria-labelledby="notion-outbox">
			<h2 id="notion-outbox" class="text-lg font-semibold">Waiting to send</h2>
			<p class="text-sm opacity-70" aria-live="polite" data-testid="notion-outbox-status">
				{#if sending}Sending…
				{:else if !connected}Connect to Notion to send these.
				{:else if outbox.some((item) => !item.failed)}Sent when the connection is back, or with
					Refresh.{/if}
			</p>
			<ul class="flex flex-col gap-2" aria-label="Waiting to send">
				{#each outbox as item (item.id)}
					<li
						class="flex flex-col gap-2 rounded-xl border border-current/20 p-3"
						data-testid="notion-outbox-item"
					>
						<p>{describeChange(item, blocks)}</p>
						{#if item.failed}
							<p class="text-sm" data-testid="notion-outbox-failed">
								{failureMessage(item.failed)}
							</p>
						{/if}
						<div class="flex flex-wrap gap-2">
							{#if item.failed}
								<button
									type="button"
									class={button}
									disabled={!connected}
									onclick={() => notion.retry(item.id)}>Retry</button
								>
							{/if}
							<button type="button" class={button} onclick={() => notion.discard(item.id)}
								>Discard</button
							>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
