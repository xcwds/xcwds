<script lang="ts">
	/**
	 * Your apps (#160): the list, each one shareable (Share design, #162) and deletable with Undo,
	 * Add from a file, and Add from a template. Render
	 * it from the `<path>` route's file (default `/my-apps`), inside `<main class="page-wide">`:
	 *
	 * ```svelte
	 * <YourApps />
	 * ```
	 *
	 * Adding a template saves a copy with a new id and opens it. Under the list: how much storage
	 * your apps take up, with a warning near the browser's limit. While `@xcwds/plugin-vault` has
	 * private apps sealed (the app is locked), one card says how many and opens the unlock screen.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import type { AppDefinition } from './format.js';
	import type {} from './client.js';
	import { go, href } from './navigate.js';
	import ShareDesign from './ShareDesign.svelte';
	import type { AppSummary, Removed, Usage } from './store.js';
	import { button, card, muted, primary } from './ui.js';
	import { lockedText, sizeText } from './view.js';

	const app = useApp();
	const blocks = app.blocks;
	type LockLike = {
		readonly state: { readonly locked: boolean };
		subscribe(listener: (state: { readonly locked: boolean }) => void): () => void;
	};
	const lock = (app as { lock?: LockLike }).lock;

	/** Undefined until listed, so the prerendered page matches the first render. */
	let list = $state.raw<AppSummary[]>();
	let usage = $state.raw<Usage>();
	/** Private apps the vault keeps sealed while locked: only their number is known. */
	let sealed = $state(0);
	let error = $state('');
	/** While `app.lock` is locked, a private app's design isn't shared (its name still shows). */
	let locked = $state(true);
	/** The last deleted app, until Undo times out. */
	let undo = $state.raw<{ name: string; removed: Removed; timer: ReturnType<typeof setTimeout> }>();

	onMount(() => {
		if (!blocks) return;
		const load = () => {
			list = blocks.list();
			usage = blocks.usage();
			sealed = blocks.lockedCount();
		};
		load();
		const stop = blocks.onChange(load);
		locked = lock?.state.locked ?? false;
		const stopLock = lock?.subscribe((s) => (locked = s.locked));
		return () => {
			stop();
			stopLock?.();
			if (undo) clearTimeout(undo.timer);
		};
	});

	function remove(summary: AppSummary) {
		if (!blocks) return;
		if (!confirm(`Delete "${summary.name}" and everything saved in it?`)) return;
		const removed = blocks.remove(summary.id);
		if (!removed.ok) return;
		if (undo) clearTimeout(undo.timer);
		undo = { name: summary.name, removed, timer: setTimeout(() => (undo = undefined), 8000) };
	}

	function restore() {
		if (!undo) return;
		clearTimeout(undo.timer);
		const { removed } = undo;
		undo = undefined;
		removed.restore();
	}

	function add(template: AppDefinition) {
		if (!blocks) return;
		const saved = blocks.addFromTemplate(template);
		if (!saved.ok) {
			error = saved.error;
			return;
		}
		error = '';
		void go(blocks.pathOf(saved.app));
	}

	const describe = (t: AppDefinition) => t.blocks.map((b) => b.label).join(', ');
</script>

{#if !blocks}
	<p>This app has no <code>@xcwds/plugin-blocks</code>.</p>
{:else}
	<div class="flex flex-col gap-6">
		<section class="flex flex-col gap-3" aria-labelledby="your-apps-heading">
			<h2 id="your-apps-heading" class="sr-only">Your apps</h2>
			<div class="flex flex-wrap gap-2">
				<a href={href(blocks.editPathOf())} class="{primary} flex items-center">New app</a>
				<a href={href(`${blocks.path}/import`)} class="{button} flex items-center"
					>Add from a file</a
				>
			</div>
			{#if list && !list.length && !sealed}
				<p class={muted} data-testid="your-apps-empty">
					No apps yet. Make one, or add one from a template below.
				</p>
			{:else if list}
				<ul class="grid gap-2 md:grid-cols-2 lg:grid-cols-3" data-testid="your-apps">
					{#each list as summary (summary.id)}
						{@const design = blocks.get(summary.id)}
						<li class="flex flex-wrap items-stretch gap-2">
							<a
								href={href(summary.path)}
								class="flex min-w-48 flex-1 items-center gap-3 rounded-xl bg-(--xcwds-shell-card) px-4 py-3 hover:bg-(--xcwds-shell-hover-bg)"
							>
								<span aria-hidden="true" class="text-2xl">{summary.emoji ?? '🧩'}</span>
								<span class="flex flex-col">
									<span class="font-medium">{summary.name}</span>
									<span class={muted}
										>{[summary.private ? 'Private' : '', sizeText(usage?.apps[summary.id] ?? 0)]
											.filter(Boolean)
											.join(' · ')}</span
									>
								</span>
							</a>
							{#if design && !(design.private && locked)}
								<ShareDesign {design} label="Share design of {summary.name}" />
							{/if}
							<button
								type="button"
								class={button}
								aria-label="Delete {summary.name}"
								onclick={() => remove(summary)}>Delete</button
							>
						</li>
					{/each}
					{#if sealed}
						<li class="flex">
							<a
								href={href(`${blocks.path}/private`)}
								class="flex min-w-48 flex-1 items-center gap-3 rounded-xl bg-(--xcwds-shell-card) px-4 py-3 hover:bg-(--xcwds-shell-hover-bg)"
								data-testid="your-apps-locked"
							>
								<span aria-hidden="true" class="text-2xl">🔒</span>
								<span class="flex flex-col">
									<span class="font-medium">{lockedText(sealed)}</span>
									<span class={muted}>Unlock to open them</span>
								</span>
							</a>
						</li>
					{/if}
				</ul>
			{/if}
			{#if usage && list?.length}
				<p class={muted} data-testid="your-apps-usage">
					Your apps use about {sizeText(usage.total)} on this device.
				</p>
				{#if usage.nearLimit}
					<p class="text-sm font-medium text-red-700 dark:text-red-400" role="alert">
						That's close to the space browsers give an app (about 5 MB). Delete apps or entries you
						don't need, or new entries may not save.
					</p>
				{/if}
			{/if}
			<p class="flex min-h-11 items-center gap-3 text-sm" aria-live="polite">
				{#if undo}
					Deleted {undo.name}.
					<button type="button" class={button} onclick={restore}>Undo</button>
				{/if}
			</p>
		</section>

		{#if blocks.templates.length}
			<section class="flex flex-col gap-3" aria-labelledby="templates-heading">
				<h2 id="templates-heading" class="text-lg font-semibold">Add from a template</h2>
				<ul class="grid gap-2 md:grid-cols-2 lg:grid-cols-3" data-testid="templates">
					{#each blocks.templates as template (template.id)}
						<li>
							<button
								type="button"
								class="{card} flex w-full items-center gap-3 text-left hover:bg-(--xcwds-shell-hover-bg)"
								onclick={() => add(template)}
							>
								<span aria-hidden="true" class="text-2xl">{template.emoji ?? '🧩'}</span>
								<span class="flex flex-col">
									<span class="font-medium">Add {template.name}</span>
									<span class={muted}
										>{describe(template)}{template.private ? ' · Private' : ''}</span
									>
								</span>
							</button>
						</li>
					{/each}
				</ul>
				{#if error}
					<p class="text-sm text-red-700 dark:text-red-400" role="alert">{error}</p>
				{/if}
			</section>
		{/if}
	</div>
{/if}
