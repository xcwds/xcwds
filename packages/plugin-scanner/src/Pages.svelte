<script lang="ts" module>
	/** Whether this page load has said that a shared or saved scan is outside the app. */
	let told = false;
</script>

<script lang="ts">
	/**
	 * The scan in progress (`@xcwds/plugin-scanner`): its pages in order, each with Up, Down,
	 * Retake and Delete (which can be undone), and Export, which shares or saves the scan as one
	 * PDF or as page images. Start over deletes every page, after a second tap.
	 *
	 * ```svelte
	 * <Pages onRetake={(id) => (retake = id)} />
	 * ```
	 *
	 * The files are made as the pages or the choices change, so Share runs straight from the tap
	 * (Safari opens the share sheet only then). While `app.lock` (from `@xcwds/plugin-lock`) is
	 * locked, nothing is rendered and no object URL exists.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import type { Scanner } from './client.js';
	import type { Paper } from './geometry.js';
	import type { PageInput, ScanPage } from './pages.js';
	import {
		SHARE_MESSAGES,
		canShareFiles,
		scanFiles,
		scannedAt,
		shareFiles,
		type FilesResult,
		type ScanFormat
	} from './share.js';

	type Text = {
		label: string;
		empty: string;
		page: (n: number, total: number) => string;
		up: string;
		down: string;
		retake: string;
		delete: string;
		/** The accessible name of a page's button: `{action} page {n}`. */
		action: (action: string, n: number) => string;
		deleted: string;
		undo: string;
		failed: string;
		export: string;
		format: string;
		pdf: string;
		images: string;
		paper: string;
		a4: string;
		letter: string;
		share: string;
		save: string;
		making: string;
		outside: string;
		shareFailed: string;
		startOver: string;
		confirmStartOver: string;
		missing: string;
	};
	const defaults: Text = {
		label: 'Pages',
		empty: 'No pages yet.',
		page: (n, total) => `Page ${n} of ${total}`,
		up: 'Up',
		down: 'Down',
		retake: 'Retake',
		delete: 'Delete',
		action: (action, n) => `${action} page ${n}`,
		deleted: 'Page deleted.',
		undo: 'Undo',
		failed: "The page couldn't be changed. Try again.",
		export: 'Export',
		format: 'Save as',
		pdf: 'PDF',
		images: 'Images',
		paper: 'Paper',
		a4: 'A4',
		letter: 'Letter',
		share: 'Share',
		save: 'Save',
		making: 'Making the file…',
		outside: SHARE_MESSAGES.outside,
		shareFailed: SHARE_MESSAGES.failed,
		startOver: 'Start over',
		confirmStartOver: 'Tap again to delete every page',
		missing: "This app doesn't have the scanner plugin."
	};

	let {
		format = $bindable('pdf'),
		paper = $bindable('a4'),
		onRetake,
		scanner: given,
		text = {}
	}: {
		/** What Export makes, `pdf` by default; bind it to keep the choice. */
		format?: ScanFormat;
		/** The PDF's paper, `a4` by default; bind it to keep the choice. */
		paper?: Paper;
		/** Shows a Retake button on each page that calls it with the page's id. */
		onRetake?: (id: string) => void;
		/** The scanner whose pages to show; `app.scanner` by default. */
		scanner?: Scanner;
		text?: Partial<Text>;
	} = $props();
	const t = $derived({ ...defaults, ...text });

	const app = useApp();
	const uid = $props.id();
	const scanner = $derived(given ?? app.scanner);

	type LockLike = {
		readonly state: { readonly locked: boolean };
		subscribe(listener: (state: { readonly locked: boolean }) => void): () => void;
	};
	const lock = (app as { lock?: LockLike }).lock;
	let locked = $state(lock?.state.locked ?? false);

	/** Undefined until listed, so the prerendered page matches the first render. */
	let list = $state.raw<ScanPage[]>();
	/** Each page's image URL, with the save it shows (a retake keeps the id, not the image). */
	let thumbs = $state<Record<string, { saved: number; url: string }>>({});
	/** A move, delete, undo or Start over is running; the page buttons wait for it. */
	let working = $state(false);
	let message = $state('');

	/** The last deleted page and where it was, until Undo times out. */
	let undo = $state.raw<{
		page: PageInput;
		index: number;
		timer: ReturnType<typeof setTimeout>;
	} | null>(null);
	const dropUndo = () => {
		if (undo) clearTimeout(undo.timer);
		undo = null;
	};

	/** The export's files for the current pages and choices; undefined while they're made. */
	let files = $state.raw<FilesResult>();
	/** Share (the share sheet takes these files) or Save (downloads). */
	const shares = $derived(files?.ok ? canShareFiles(files.files) : false);
	let sharing = $state(false);
	let note = $state('');

	let listing = 0;
	async function refresh() {
		if (!scanner || locked) return;
		const run = ++listing;
		const next = await scanner.pages.list();
		if (run !== listing || locked) return;
		list = next;
		const ids = new Set(next.map((p) => p.id));
		for (const id of Object.keys(thumbs)) if (!ids.has(id)) forget(id);
		for (const page of next) if (thumbs[page.id]?.saved !== page.saved) void load(page);
	}

	async function load(page: ScanPage) {
		if (!scanner) return;
		const blob = await scanner.pages.get(page.id);
		// Still the page's latest image, and still unlocked, once read.
		const now = list?.find((p) => p.id === page.id);
		if (!blob || locked || now?.saved !== page.saved || thumbs[page.id]?.saved === page.saved)
			return;
		forget(page.id);
		thumbs[page.id] = { saved: page.saved, url: URL.createObjectURL(blob) };
	}

	function forget(id: string) {
		const thumb = thumbs[id];
		if (!thumb) return;
		URL.revokeObjectURL(thumb.url);
		delete thumbs[id];
	}
	function forgetAll() {
		for (const id of Object.keys(thumbs)) forget(id);
	}

	/** Runs a change to the pages, one at a time, saying when it didn't work. */
	async function change(task: () => Promise<boolean | string>) {
		if (!scanner || working) return;
		working = true;
		message = '';
		try {
			const result = await task();
			if (result === false) message = t.failed;
			else if (typeof result === 'string') message = result;
		} finally {
			working = false;
		}
	}

	const move = (page: ScanPage, by: -1 | 1) =>
		change(async () => {
			const index = list?.findIndex((p) => p.id === page.id) ?? -1;
			return index >= 0 && scanner!.pages.move(page.id, index + by);
		});

	const remove = (page: ScanPage) =>
		change(async () => {
			const index = list?.findIndex((p) => p.id === page.id) ?? -1;
			const blob = await scanner!.pages.get(page.id);
			if (!(await scanner!.pages.delete(page.id))) return false;
			dropUndo();
			// Locked meanwhile: the lock's reset may clear the scan, and Undo mustn't bring it back.
			if (blob && index >= 0 && !locked) {
				const saved = { blob, width: page.width, height: page.height, filter: page.filter };
				undo = { page: saved, index, timer: setTimeout(() => (undo = null), 8000) };
			} else message = t.deleted;
			return true;
		});

	const restore = () =>
		change(async () => {
			if (!undo) return true;
			const { page, index } = undo;
			dropUndo();
			const added = await scanner!.pages.add(page);
			if (!added.ok) return added.error;
			return scanner!.pages.move(added.id, index);
		});

	/** Start over can't be undone, so it takes a second tap within a few seconds. */
	let confirming = $state(false);
	let confirmTimer: ReturnType<typeof setTimeout> | undefined;
	const unconfirm = () => {
		clearTimeout(confirmTimer);
		confirming = false;
	};
	function startOver() {
		if (!confirming) {
			confirming = true;
			confirmTimer = setTimeout(unconfirm, 4000);
			return;
		}
		unconfirm();
		void change(async () => {
			dropUndo();
			note = '';
			return scanner!.pages.clear();
		});
	}

	// Makes the export's files for the pages and choices showing; a newer run replaces one still going.
	$effect(() => {
		const pages = list;
		// Paper only matters to a PDF.
		const options = format === 'pdf' ? { format, paper } : { format };
		files = undefined;
		if (!scanner || !pages?.length || locked) return;
		let current = true;
		scanFiles(scanner.pages, { ...options, scannedAt: scannedAt(pages) }).then(
			(made) => {
				if (current) files = made;
			},
			(e: unknown) => {
				if (current) files = { ok: false, error: e instanceof Error ? e.message : String(e) };
			}
		);
		return () => {
			current = false;
		};
	});

	/** The scan leaves the app only here, on the person's tap. */
	async function share() {
		if (!files?.ok || sharing) return;
		note = '';
		sharing = true;
		const outcome = await shareFiles(files.files).finally(() => (sharing = false));
		if (outcome === 'failed') note = t.shareFailed;
		else if (outcome !== 'cancelled' && !told) {
			told = true;
			note = t.outside;
		}
	}

	onMount(() => {
		const stopLock = lock?.subscribe((state) => {
			if (state.locked === locked) return;
			locked = state.locked;
			if (locked) {
				dropUndo();
				unconfirm();
				forgetAll();
				list = undefined;
				message = '';
				note = '';
			} else void refresh();
		});
		void refresh();
		const stop = scanner?.pages.onChange(() => void refresh());
		return () => {
			stopLock?.();
			stop?.();
			dropUndo();
			unconfirm();
			forgetAll();
		};
	});

	const formats: ScanFormat[] = ['pdf', 'images'];
	const papers: Paper[] = ['a4', 'letter'];
	const button =
		'min-h-11 min-w-11 rounded-xl bg-(--xcwds-shell-card) px-3 font-medium hover:not-disabled:bg-(--xcwds-shell-hover-bg) active:bg-(--xcwds-shell-hover-bg) disabled:opacity-40';
</script>

{#if !locked}
	<div class="flex flex-col gap-3" data-testid="scan">
		{#if !scanner}
			<p>{t.missing}</p>
		{:else if list && list.length === 0}
			<p class="text-(--xcwds-shell-muted)">{t.empty}</p>
		{:else if list}
			<ol class="flex flex-col gap-2" aria-label={t.label}>
				{#each list as page, index (page.id)}
					{@const n = index + 1}
					<li
						class="flex items-center gap-3 rounded-xl bg-(--xcwds-shell-card) p-2"
						data-testid="scan-page"
						data-id={page.id}
						data-filter={page.filter}
					>
						<div class="flex h-20 w-16 shrink-0 items-center justify-center">
							{#if thumbs[page.id]}
								<img
									src={thumbs[page.id]!.url}
									alt={t.page(n, list.length)}
									class="max-h-full max-w-full rounded-sm bg-white shadow"
									decoding="async"
								/>
							{/if}
						</div>
						<div class="flex min-w-0 flex-1 flex-col gap-1">
							<span class="font-medium">{t.page(n, list.length)}</span>
							<div class="flex flex-wrap gap-1">
								<button
									type="button"
									class={button}
									aria-label={t.action(t.up, n)}
									disabled={working || index === 0}
									onclick={() => move(page, -1)}>{t.up}</button
								>
								<button
									type="button"
									class={button}
									aria-label={t.action(t.down, n)}
									disabled={working || index === list.length - 1}
									onclick={() => move(page, 1)}>{t.down}</button
								>
								{#if onRetake}
									<button
										type="button"
										class={button}
										aria-label={t.action(t.retake, n)}
										disabled={working}
										onclick={() => onRetake(page.id)}>{t.retake}</button
									>
								{/if}
								<button
									type="button"
									class={button}
									aria-label={t.action(t.delete, n)}
									disabled={working}
									onclick={() => remove(page)}>{t.delete}</button
								>
							</div>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
		{#if scanner}
			<p
				class="flex min-h-11 items-center gap-3 text-sm"
				aria-live="polite"
				data-testid="scan-status"
			>
				{#if undo}
					{t.deleted}
					<button type="button" class={button} onclick={restore} disabled={working}>{t.undo}</button
					>
				{:else}
					{message}
				{/if}
			</p>
		{/if}

		{#if scanner && list?.length}
			<section class="flex flex-col gap-3" aria-labelledby="{uid}-export">
				<h2 id="{uid}-export" class="text-lg font-semibold">{t.export}</h2>
				<fieldset class="flex flex-wrap items-center gap-x-4 gap-y-1">
					<legend class="font-medium">{t.format}</legend>
					{#each formats as option (option)}
						<label class="flex min-h-11 items-center gap-2">
							<input
								type="radio"
								class="size-5"
								name="{uid}-format"
								value={option}
								bind:group={format}
							/>
							{t[option]}
						</label>
					{/each}
				</fieldset>
				{#if format === 'pdf'}
					<fieldset class="flex flex-wrap items-center gap-x-4 gap-y-1">
						<legend class="font-medium">{t.paper}</legend>
						{#each papers as option (option)}
							<label class="flex min-h-11 items-center gap-2">
								<input
									type="radio"
									class="size-5"
									name="{uid}-paper"
									value={option}
									bind:group={paper}
								/>
								{t[option]}
							</label>
						{/each}
					</fieldset>
				{/if}
				<div class="flex flex-wrap items-center gap-3">
					<button
						type="button"
						class="min-h-11 rounded-xl bg-(--xcwds-shell-accent) px-4 font-medium text-white hover:not-disabled:opacity-90 active:opacity-90 disabled:opacity-40"
						onclick={share}
						disabled={!files?.ok || sharing}
						data-testid="scan-export"
					>
						{files ? (shares ? t.share : t.save) : t.making}
					</button>
					<button
						type="button"
						class={confirming
							? 'min-h-11 rounded-xl bg-red-700 px-4 font-medium text-white hover:not-disabled:bg-red-800 active:bg-red-800 disabled:opacity-40'
							: button}
						onclick={startOver}
						disabled={working}>{confirming ? t.confirmStartOver : t.startOver}</button
					>
				</div>
				<p class="text-sm" aria-live="polite" data-testid="scan-note">
					{#if files && !files.ok}
						<span class="text-red-700 dark:text-red-400">{files.error}</span>
					{:else}
						{note}
					{/if}
				</p>
			</section>
		{/if}
	</div>
{/if}
