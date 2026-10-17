<script lang="ts">
	/**
	 * The builder (#161): make an app from blocks, or change one. Render it from the
	 * `<path>/edit` and `<path>/private-edit` routes' files, inside `<main class="page-narrow">`:
	 *
	 * ```svelte
	 * <AppBuilder />            <!-- src/routes/my-apps/edit/+page.svelte -->
	 * <AppBuilder private />    <!-- src/routes/my-apps/private-edit/+page.svelte -->
	 * ```
	 *
	 * With no fragment it makes a new app; `#<id>` edits that one (a private app on the private
	 * page, which `@xcwds/plugin-lock` locks). Save checks the app with `parseApp` and shows the
	 * problem next to Save; when the change would drop saved data (`dataLoss`), it says what and
	 * asks first. Saving opens the app.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import BlockSettings from './builder/BlockSettings.svelte';
	import { BLOCK_TYPES } from './builder/types.js';
	import type {} from './client.js';
	import { blankApp, blankBlock, dataLoss, lossText, move } from './edit.js';
	import { LIMITS, parseApp, type AppDefinition, type Block } from './format.js';
	import { go, href } from './navigate.js';
	import { button, card, field as input, muted, primary } from './ui.js';

	let { private: personal = false }: { private?: boolean } = $props();

	const app = useApp();
	const blocks = app.blocks;
	type ShellLike = { setTitle(text: string | undefined): void };
	type LockLike = {
		readonly state: { readonly locked: boolean };
		subscribe(listener: (state: { readonly locked: boolean }) => void): () => void;
	};
	const lock = (app as { lock?: LockLike }).lock;

	/** Common picks; any one emoji can be typed instead. */
	const EMOJI = ['🧩', '💧', '🧹', '✅', '📝', '📈', '💊', '🏃', '😊', '🌱', '📚', '🍎'];

	/** Undefined until the page has read the fragment, so the prerendered page matches. */
	let loaded = $state(false);
	let locked = $state(false);
	/** The saved app being edited; undefined for a new one. */
	let before = $state.raw<AppDefinition>();
	/** An id in the fragment that isn't on this device. */
	let missing = $state(false);
	let draft = $state<AppDefinition>(blankApp());
	let nameError = $state('');
	let error = $state('');
	/** The last block or field removed, until Undo times out. */
	let undo = $state.raw<{
		label: string;
		restore: () => void;
		timer: ReturnType<typeof setTimeout>;
	}>();

	function load() {
		if (!blocks) return;
		let id = '';
		try {
			id = decodeURIComponent(location.hash.slice(1));
		} catch {
			// A malformed fragment names no app.
		}
		const found = id ? blocks.get(id) : undefined;
		if (found && found.private !== personal) {
			void go(blocks.editPathOf(found), true);
			return;
		}
		missing = !!id && !found;
		before = found;
		draft = found ? (JSON.parse(JSON.stringify(found)) as AppDefinition) : blankApp();
		if (!found && personal) draft.private = true;
		nameError = error = '';
		loaded = true;
		(app as { shell?: ShellLike }).shell?.setTitle(found ? `Edit ${found.name}` : undefined);
	}

	onMount(() => {
		const stopLock = personal ? lock?.subscribe((s) => (locked = s.locked)) : undefined;
		load();
		addEventListener('hashchange', load);
		return () => {
			removeEventListener('hashchange', load);
			stopLock?.();
			if (undo) clearTimeout(undo.timer);
		};
	});

	function removed(label: string, restore: () => void) {
		if (undo) clearTimeout(undo.timer);
		undo = { label, restore, timer: setTimeout(() => (undo = undefined), 8000) };
	}

	function restore() {
		if (!undo) return;
		clearTimeout(undo.timer);
		const { restore } = undo;
		undo = undefined;
		restore();
	}

	function addBlock(type: Block['type']) {
		draft.blocks.push(blankBlock(type));
	}

	function removeBlock(index: number) {
		const block = draft.blocks[index];
		if (!block) return;
		draft.blocks.splice(index, 1);
		removed(block.label || 'the block', () => {
			if (draft.blocks.some((b) => b.id === block.id)) return;
			draft.blocks.splice(Math.min(index, draft.blocks.length), 0, block);
		});
	}

	/** Keeps the first character a person sees (one emoji, flags and skin tones included). */
	function firstGrapheme(text: string): string {
		const trimmed = text.trim();
		if (!trimmed) return '';
		if (typeof Intl.Segmenter !== 'function') return trimmed.slice(0, LIMITS.emoji);
		const [first] = new Intl.Segmenter().segment(trimmed);
		return first ? first.segment.slice(0, LIMITS.emoji) : '';
	}

	function setEmoji(text: string) {
		const emoji = firstGrapheme(text);
		if (emoji) draft.emoji = emoji;
		else delete draft.emoji;
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		if (!blocks) return;
		error = '';
		nameError = draft.name.trim() ? '' : 'Give the app a name.';
		if (nameError) {
			document.getElementById('builder-name')?.focus();
			return;
		}
		const parsed = parseApp($state.snapshot(draft));
		if (!parsed.ok) {
			error = parsed.error;
			return;
		}
		if (before) {
			const losses = dataLoss(before, parsed.value, blocks.data(before.id));
			if (
				losses.length &&
				!confirm(`Saving removes:\n\n${losses.map((l) => `• ${lossText(l)}`).join('\n')}\n\nSave?`)
			)
				return;
		}
		const saved = blocks.save(parsed.value);
		if (!saved.ok) {
			error = saved.error;
			return;
		}
		void go(blocks.pathOf(saved.app), true);
	}

	function discard() {
		if (!blocks) return;
		void go(before ? blocks.pathOf(before) : blocks.path);
	}

	const atLimit = $derived(draft.blocks.length >= LIMITS.blocks);
</script>

{#if !blocks}
	<p>This app has no <code>@xcwds/plugin-blocks</code>.</p>
{:else if loaded && !locked}
	{#if missing}
		<div class="flex flex-col items-start gap-3" data-testid="blocks-missing">
			<p>This app isn't on this device.</p>
			<a href={href(blocks.path)} class="{button} flex items-center">Your apps</a>
		</div>
	{:else}
		<form class="flex flex-col gap-6" onsubmit={save} novalidate data-testid="builder">
			<section class="flex flex-col gap-4" aria-labelledby="builder-about">
				<h2 id="builder-about" class="sr-only">About the app</h2>
				<label class="flex flex-col gap-1" for="builder-name">
					<span class="font-medium">Name</span>
					<input
						id="builder-name"
						class={input}
						maxlength={LIMITS.name}
						bind:value={draft.name}
						autocomplete="off"
						aria-invalid={nameError ? 'true' : undefined}
						aria-describedby={nameError ? 'builder-name-error' : undefined}
					/>
				</label>
				{#if nameError}
					<p id="builder-name-error" class="-mt-3 text-sm text-red-700 dark:text-red-400">
						{nameError}
					</p>
				{/if}
				<div class="flex flex-col gap-2">
					<label class="flex flex-col gap-1" for="builder-emoji">
						<span class="font-medium">Emoji</span>
						<input
							id="builder-emoji"
							class="{input} w-24 text-2xl"
							value={draft.emoji ?? ''}
							onchange={(e) => {
								setEmoji(e.currentTarget.value);
								e.currentTarget.value = draft.emoji ?? '';
							}}
							autocomplete="off"
						/>
					</label>
					<div class="flex flex-wrap gap-1" role="group" aria-label="Common emoji">
						{#each EMOJI as emoji (emoji)}
							<button
								type="button"
								class="flex size-11 items-center justify-center rounded-lg text-2xl hover:bg-(--xcwds-shell-hover-bg) active:bg-(--xcwds-shell-hover-bg) {draft.emoji ===
								emoji
									? 'bg-(--xcwds-shell-card) ring-2 ring-(--xcwds-shell-accent)'
									: ''}"
								aria-label="Use {emoji}"
								aria-pressed={draft.emoji === emoji}
								onclick={() => (draft.emoji = emoji)}>{emoji}</button
							>
						{/each}
					</div>
				</div>
				<div class="flex flex-col gap-1">
					<label class="flex min-h-11 cursor-pointer items-center gap-3 font-medium">
						<input
							type="checkbox"
							class="size-5 shrink-0 accent-(--xcwds-shell-accent)"
							bind:checked={draft.private}
							aria-describedby="builder-private-hint"
						/>
						Private
					</label>
					<p id="builder-private-hint" class={muted}>
						Locked with your passcode and kept out of Recently used. Keep the name discreet: it
						shows in your app list.
					</p>
				</div>
			</section>

			<section class="flex flex-col gap-4" aria-labelledby="builder-blocks">
				<h2 id="builder-blocks" class="text-lg font-semibold">
					Blocks <span class={muted}>({draft.blocks.length} of {LIMITS.blocks})</span>
				</h2>
				{#each draft.blocks as block, i (block.id)}
					{@const kind = BLOCK_TYPES.find(([t]) => t === block.type)?.[1]}
					<section
						class="{card} flex flex-col gap-4"
						aria-label="{kind}: {block.label || 'no heading'}"
						data-testid="builder-block"
					>
						<p class="text-sm font-medium">{kind}</p>
						<BlockSettings bind:block={draft.blocks[i]!} onremoved={removed} />
						<div class="flex flex-wrap gap-2 border-t border-(--xcwds-shell-border) pt-3">
							<button
								type="button"
								class={button}
								disabled={i === 0}
								aria-label="Move {block.label || 'block'} up"
								onclick={() => (draft.blocks = move(draft.blocks, i, -1))}>Move up</button
							>
							<button
								type="button"
								class={button}
								disabled={i === draft.blocks.length - 1}
								aria-label="Move {block.label || 'block'} down"
								onclick={() => (draft.blocks = move(draft.blocks, i, 1))}>Move down</button
							>
							<button
								type="button"
								class={button}
								aria-label="Remove {block.label || 'block'}"
								onclick={() => removeBlock(i)}>Remove block</button
							>
						</div>
					</section>
				{/each}
				{#if !draft.blocks.length}
					<p class={muted}>No blocks yet. Add one below.</p>
				{/if}
				<p class="flex min-h-11 items-center gap-3 text-sm" aria-live="polite">
					{#if undo}
						Removed {undo.label}.
						<button type="button" class={button} onclick={restore}>Undo</button>
					{/if}
				</p>
			</section>

			<section class="flex flex-col gap-3" aria-labelledby="builder-add">
				<h2 id="builder-add" class="text-lg font-semibold">Add a block</h2>
				{#if atLimit}
					<p class={muted}>An app can have up to {LIMITS.blocks} blocks.</p>
				{/if}
				<ul class="grid gap-2 sm:grid-cols-2">
					{#each BLOCK_TYPES as [type, name, blurb] (type)}
						<li>
							<button
								type="button"
								class="{card} flex w-full flex-col items-start text-left hover:not-disabled:bg-(--xcwds-shell-hover-bg) active:bg-(--xcwds-shell-hover-bg) disabled:opacity-40"
								disabled={atLimit}
								onclick={() => addBlock(type)}
							>
								<span class="font-medium">Add {name.toLowerCase()}</span>
								<span class={muted}>{blurb}</span>
							</button>
						</li>
					{/each}
				</ul>
			</section>

			<div class="flex flex-col gap-2">
				{#if error}
					<p
						class="text-sm text-red-700 dark:text-red-400"
						role="alert"
						data-testid="builder-error"
					>
						{error}
					</p>
				{/if}
				<div class="flex flex-wrap gap-2">
					<button type="submit" class={primary}>Save</button>
					<button type="button" class={button} onclick={discard}>Discard changes</button>
				</div>
			</div>
		</form>
	{/if}
{/if}
