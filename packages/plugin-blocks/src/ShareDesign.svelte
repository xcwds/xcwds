<script lang="ts">
	/**
	 * Share design (#162): a button that opens a dialog with the app's design as a link (the
	 * system share sheet where there is one, and Copy link) and as a file. The design only: never
	 * what's saved in the app. A private app asks first. A design too big for a link
	 * (`MAX_LINK`) is offered as a file only.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import type {} from './client.js';
	import { MAX_LINK, designFile, designFragment, encodeDesign } from './design.js';
	import type { AppDefinition } from './format.js';
	import { href } from './navigate.js';
	import { button, muted, primary } from './ui.js';

	let {
		design,
		label = 'Share design',
		note = ''
	}: {
		/** The app as saved. */
		design: AppDefinition;
		/** The button's accessible name, when its text isn't enough (in a list of apps). */
		label?: string;
		/** A line under the dialog's heading, such as "As it was last saved." */
		note?: string;
	} = $props();

	const app = useApp();
	const blocks = app.blocks;
	/** From `@xcwds/plugin-shell`, if the app has it. */
	const toast = (message: string) =>
		(app as { toast?: (message: string) => void }).toast?.(message);

	let dialog = $state<HTMLDialogElement>();
	/** The link, once made; `''` when the design is too big for one. */
	let link = $state<string>();
	const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

	async function open() {
		if (!blocks) return;
		if (
			design.private &&
			!confirm(
				`"${design.name}" is private. Its name and fields will be visible to whoever gets the link or file. Share it anyway?`
			)
		)
			return;
		link = undefined;
		dialog?.showModal();
		// Made before Share or Copy is tapped: browsers only share from a tap.
		const made = `${location.origin}${href(`${blocks.path}/import`)}${designFragment(await encodeDesign(design))}`;
		link = made.length <= MAX_LINK ? made : '';
	}

	async function shareLink() {
		if (!link) return;
		try {
			await navigator.share({ title: design.name, url: link });
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			await copy();
		}
	}

	async function copy() {
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link);
			toast('Link copied.');
		} catch {
			toast("Couldn't copy the link.");
		}
	}

	function save() {
		const file = designFile(design);
		const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = file.name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url));
	}
</script>

<button type="button" class={button} aria-label={label} onclick={open}>Share design</button>

<dialog
	bind:this={dialog}
	class="m-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl bg-(--xcwds-shell-bg) p-5 text-(--xcwds-shell-text) shadow-xl backdrop:bg-black/40"
	aria-label="Share “{design.name}”"
	data-testid="share-design"
>
	<div class="flex flex-col gap-4">
		<h2 class="text-lg font-semibold">Share “{design.name}”</h2>
		<p class={muted}>
			{note ? `${note} ` : ''}Whoever opens it can add their own copy of how this app is built. What
			you've saved in it stays here.
		</p>
		{#if link === undefined}
			<p class={muted} role="status">Making the link…</p>
		{:else if link === ''}
			<p class={muted} role="status">This app is too big for a link. Save it as a file instead.</p>
		{/if}
		<div class="flex flex-wrap gap-2">
			{#if link && canShare}
				<button type="button" class={primary} onclick={shareLink}>Share link</button>
			{/if}
			{#if link}
				<button type="button" class={canShare ? button : primary} onclick={copy}>Copy link</button>
			{/if}
			<button type="button" class={button} onclick={save}>Save as file</button>
			<button type="button" class={button} onclick={() => dialog?.close()}>Close</button>
		</div>
	</div>
</dialog>
