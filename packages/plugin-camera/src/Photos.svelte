<script lang="ts" module>
	/** Whether this page load has said that a shared or saved photo is outside the app. */
	let told = false;
</script>

<script lang="ts">
	/**
	 * The photos kept in the app (`@xcwds/plugin-camera`): a grid of thumbnails, newest first, and
	 * a viewer with Previous and Next (arrow keys and swipes too), Share (or Save where files can't
	 * be shared) and Delete, which can be undone.
	 *
	 * ```svelte
	 * <Photos />
	 * ```
	 *
	 * Thumbnails load as they scroll into view and their object URLs are revoked as they leave it,
	 * when the photo goes and when the grid does. While `app.lock` (from `@xcwds/plugin-lock`) is
	 * locked, nothing is rendered and no object URL exists.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import {
		describeRemoved,
		type PhotoInput,
		type Photos as PhotoStore,
		type SavedPhoto
	} from './photos.js';
	import { SHARE_MESSAGES, canShareFiles, sharePhoto } from './share.js';

	type Text = {
		label: string;
		empty: string;
		open: string;
		close: string;
		previous: string;
		next: string;
		delete: string;
		share: string;
		save: string;
		outside: string;
		shareFailed: string;
		deleted: string;
		undo: string;
		failed: string;
		missing: string;
		add: string;
		adding: string;
		added: (count: number) => string;
		notAdded: (count: number) => string;
	};
	const defaults: Text = {
		label: 'Photos',
		empty: 'No photos yet.',
		open: 'Photo taken',
		close: 'Close',
		previous: 'Previous photo',
		next: 'Next photo',
		delete: 'Delete',
		share: 'Share',
		save: 'Save',
		outside: SHARE_MESSAGES.outside,
		shareFailed: SHARE_MESSAGES.failed,
		deleted: 'Photo deleted.',
		undo: 'Undo',
		failed: "The photo couldn't be deleted. Try again.",
		missing: "This app doesn't keep photos (no camera plugin).",
		add: 'Add from files',
		adding: 'Adding…',
		added: (n) => (n === 1 ? 'Added 1 photo.' : `Added ${n} photos.`),
		notAdded: (n) => (n === 1 ? "1 file wasn't added:" : `${n} files weren't added:`)
	};

	let {
		photos: given,
		text = {}
	}: {
		/** The store to show; `app.photos` by default. */
		photos?: PhotoStore;
		text?: Partial<Text>;
	} = $props();
	const t = $derived({ ...defaults, ...text });

	const app = useApp();
	const store = $derived(given ?? app.photos);

	type LockLike = {
		readonly state: { readonly locked: boolean };
		subscribe(listener: (state: { readonly locked: boolean }) => void): () => void;
	};
	const lock = (app as { lock?: LockLike }).lock;
	let locked = $state(lock?.state.locked ?? false);

	/** Undefined until listed, so the prerendered page matches the first render. */
	let list = $state.raw<SavedPhoto[]>();
	/** Thumbnail URLs by photo id, for the tiles on screen. */
	let urls = $state<Record<string, string>>({});
	/** Tiles on screen, wanted or not (a thumbnail that loads after its tile left is dropped). */
	const wanted: Record<string, boolean> = {};

	/** The photo open in the viewer, by id, and its full-size URL. */
	let current = $state<string | null>(null);
	let full = $state<string | null>(null);
	/** The open photo's file, loaded with it, so Share runs straight from the tap. */
	let file = $state.raw<{ id: string; blob: Blob } | null>(null);
	/** Share (the share sheet takes files) or Save (a download). Read in the page only. */
	let shares = $state(false);
	/** What the viewer says: that a photo left the app, or that it couldn't. */
	let notice = $state('');
	/** The share sheet is open (a second `navigator.share` meanwhile would be refused). */
	let sharing = $state(false);
	let dialog: HTMLDialogElement | undefined = $state();
	const index = $derived(list && current ? list.findIndex((p) => p.id === current) : -1);
	const shown = $derived(index >= 0 ? list![index] : undefined);

	/** The last deleted photo, until Undo times out. */
	let undo = $state.raw<{ photo: PhotoInput; timer: ReturnType<typeof setTimeout> } | null>(null);
	let message = $state('');

	const date = (ms: number) =>
		new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	let listing = 0;
	async function refresh() {
		if (!store || locked) return;
		const run = ++listing;
		const next = await store.list();
		if (run !== listing || locked) return;
		list = next;
		// Drop thumbnails of photos that are gone.
		const ids = new Set(next.map((p) => p.id));
		for (const id of Object.keys(urls)) if (!ids.has(id)) forget(id);
		if (current && current !== removing && !ids.has(current)) close();
	}

	function forget(id: string) {
		const url = urls[id];
		if (!url) return;
		URL.revokeObjectURL(url);
		delete urls[id];
	}
	function forgetAll() {
		for (const id of Object.keys(urls)) forget(id);
		if (full) URL.revokeObjectURL(full);
		full = null;
		file = null;
	}

	async function load(photo: SavedPhoto) {
		if (!store || urls[photo.id]) return;
		const blob = await store.thumbnail(photo);
		if (!blob || !wanted[photo.id] || locked || urls[photo.id]) return;
		urls[photo.id] = URL.createObjectURL(blob);
	}

	/** Loads a tile's thumbnail while it's on screen (or near it), and lets it go when it isn't. */
	function lazy(node: HTMLElement, photo: SavedPhoto) {
		const show = (on: boolean) => {
			wanted[photo.id] = on;
			if (on) void load(photo);
			else forget(photo.id);
		};
		if (typeof IntersectionObserver === 'undefined') {
			show(true);
			return { destroy: () => show(false) };
		}
		const observer = new IntersectionObserver((entries) => show(entries.at(-1)!.isIntersecting), {
			rootMargin: '200px'
		});
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
				show(false);
			}
		};
	}

	let opening = 0;
	async function open(id: string) {
		if (!store) return;
		current = id;
		message = '';
		notice = '';
		if (dialog && !dialog.open) dialog.showModal();
		const run = ++opening;
		const blob = await store.get(id);
		if (run !== opening || current !== id || locked) return;
		if (full) URL.revokeObjectURL(full);
		full = blob ? URL.createObjectURL(blob) : null;
		file = blob ? { id, blob } : null;
	}
	function close() {
		opening++;
		current = null;
		notice = '';
		if (full) URL.revokeObjectURL(full);
		full = null;
		file = null;
		if (dialog?.open) dialog.close();
	}
	function step(by: number) {
		if (!list || index < 0) return;
		const next = list[index + by];
		if (next) void open(next.id);
	}

	/** The photo being deleted: the list may drop it before `delete` returns. */
	let removing: string | null = null;
	async function remove() {
		if (!store || !shown || removing) return;
		const photo = shown;
		// The next photo opens in its place (or the previous one, at the end); none left: close.
		const after = list?.filter((p) => p.id !== photo.id) ?? [];
		const next = after[Math.min(index, after.length - 1)];
		removing = photo.id;
		try {
			const blob = await store.get(photo.id);
			if (!(await store.delete(photo.id))) {
				message = t.failed;
				return;
			}
			if (current === photo.id) {
				if (next) void open(next.id);
				else close();
			}
			if (undo) clearTimeout(undo.timer);
			undo = blob
				? {
						photo: { blob, width: photo.width, height: photo.height, takenAt: photo.takenAt },
						timer: setTimeout(() => (undo = null), 8000)
					}
				: null;
			if (!undo) message = t.deleted;
		} finally {
			removing = null;
		}
	}
	async function restore() {
		if (!store || !undo) return;
		const { photo, timer } = undo;
		clearTimeout(timer);
		undo = null;
		const saved = await store.save(photo);
		if (!saved.ok) message = saved.error;
	}

	/** The photo leaves the app only here, on the person's tap. */
	async function share() {
		if (!shown || file?.id !== shown.id || sharing) return;
		notice = '';
		sharing = true;
		const outcome = await sharePhoto({ blob: file.blob, takenAt: shown.takenAt }).finally(
			() => (sharing = false)
		);
		if (outcome === 'failed') notice = t.shareFailed;
		else if (outcome !== 'cancelled' && !told) {
			told = true;
			notice = t.outside;
		}
	}

	function keydown(event: KeyboardEvent) {
		if (event.key === 'ArrowLeft') step(-1);
		else if (event.key === 'ArrowRight') step(1);
		else return;
		event.preventDefault();
	}

	// Swipe left or right in the viewer for the next or previous photo.
	let swipe: { x: number; y: number; id: number } | null = null;
	function pointerDown(event: PointerEvent) {
		if (event.pointerType === 'mouse') return;
		swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
	}
	function pointerUp(event: PointerEvent) {
		if (!swipe || swipe.id !== event.pointerId) return;
		const dx = event.clientX - swipe.x;
		const dy = event.clientY - swipe.y;
		swipe = null;
		if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
	}

	/** Picked files being cleaned and saved; app updates wait (they'd lose them). */
	let adding = $state(false);
	let picker: HTMLInputElement | undefined = $state();
	async function addFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		// Cleared at once, so picking the same files again still fires `change`.
		input.value = '';
		if (!store || !files.length || adding) return;
		adding = true;
		message = '';
		try {
			const result = await store.add(files);
			const lines: string[] = [];
			if (result.added) lines.push(`${t.added(result.added)} ${describeRemoved(result.removed)}`);
			if (result.failed.length) {
				const [first] = result.failed;
				lines.push(`${t.notAdded(result.failed.length)} ${first!.name}: ${first!.error}`);
			}
			message = lines.join(' ');
		} finally {
			adding = false;
		}
	}

	onMount(() => {
		shares = canShareFiles();
		const update = (app as { update?: { markBusy(name: string, busy: () => boolean): () => void } })
			.update;
		const unmark = update?.markBusy('photos being added', () => adding);
		const stopLock = lock?.subscribe((state) => {
			if (state.locked === locked) return;
			locked = state.locked;
			if (locked) {
				// A lock's reset may clear the photos: Undo must not bring one back.
				if (undo) clearTimeout(undo.timer);
				undo = null;
				close();
				forgetAll();
				list = undefined;
			} else void refresh();
		});
		void refresh();
		const stop = store?.onChange(() => void refresh());
		return () => {
			unmark?.();
			stopLock?.();
			stop?.();
			if (undo) clearTimeout(undo.timer);
			forgetAll();
		};
	});
</script>

{#if !locked}
	<div class="flex flex-col gap-3" data-testid="photos">
		{#if store}
			<input
				bind:this={picker}
				type="file"
				accept="image/*"
				multiple
				class="hidden"
				aria-label={t.add}
				onchange={addFiles}
			/>
			<button
				type="button"
				class="min-h-11 w-fit rounded-xl bg-(--xcwds-shell-card) px-4 font-medium hover:not-disabled:bg-(--xcwds-shell-hover-bg) active:bg-(--xcwds-shell-hover-bg) disabled:opacity-40"
				onclick={() => picker?.click()}
				disabled={adding}>{adding ? t.adding : t.add}</button
			>
		{/if}
		{#if !store}
			<p>{t.missing}</p>
		{:else if list && list.length === 0}
			<p class="text-(--xcwds-shell-muted)">{t.empty}</p>
		{:else if list}
			<ul class="grid grid-cols-3 gap-1 sm:grid-cols-4" aria-label={t.label}>
				{#each list as photo (photo.id)}
					<li>
						<button
							type="button"
							class="block aspect-square w-full overflow-hidden rounded-md bg-(--xcwds-shell-card)"
							onclick={() => open(photo.id)}
							use:lazy={photo}
							aria-label="{t.open} {date(photo.takenAt)}"
						>
							{#if urls[photo.id]}
								<img src={urls[photo.id]} alt="" class="size-full object-cover" />
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		<p
			class="flex min-h-11 items-center gap-3 text-sm"
			aria-live="polite"
			data-testid="photos-status"
		>
			{#if undo}
				{t.deleted}
				<button
					type="button"
					class="min-h-11 rounded-xl bg-(--xcwds-shell-card) px-4 font-medium hover:not-disabled:bg-(--xcwds-shell-hover-bg) active:bg-(--xcwds-shell-hover-bg)"
					onclick={restore}>{t.undo}</button
				>
			{:else}
				{message}
			{/if}
		</p>
	</div>

	<dialog
		bind:this={dialog}
		class="m-auto max-h-full max-w-full bg-black p-0 text-white backdrop:bg-black/80"
		aria-label={shown ? `${t.open} ${date(shown.takenAt)}` : t.open}
		onclose={close}
		onkeydown={keydown}
		data-testid="photo-viewer"
	>
		{#if shown}
			<div class="flex h-dvh w-screen flex-col">
				<div
					class="flex min-h-0 flex-1 items-center justify-center"
					style:touch-action="pan-y pinch-zoom"
					onpointerdown={pointerDown}
					onpointerup={pointerUp}
					onpointercancel={() => (swipe = null)}
					role="presentation"
				>
					{#if full}
						<img
							src={full}
							alt="{t.open} {date(shown.takenAt)}"
							class="max-h-full max-w-full object-contain"
							draggable="false"
						/>
					{/if}
				</div>
				<div class="flex flex-wrap items-center justify-center gap-2 p-3">
					<button
						type="button"
						class="min-h-11 rounded-xl bg-white/15 px-4 font-medium hover:not-disabled:bg-white/25 active:bg-white/25 disabled:opacity-40"
						onclick={() => step(-1)}
						disabled={index <= 0}>{t.previous}</button
					>
					<button
						type="button"
						class="min-h-11 rounded-xl bg-white/15 px-4 font-medium hover:not-disabled:bg-white/25 active:bg-white/25 disabled:opacity-40"
						onclick={() => step(1)}
						disabled={!list || index >= list.length - 1}>{t.next}</button
					>
					<button
						type="button"
						class="min-h-11 rounded-xl bg-white/15 px-4 font-medium hover:not-disabled:bg-white/25 active:bg-white/25 disabled:opacity-40"
						onclick={share}
						disabled={file?.id !== shown.id || sharing}>{shares ? t.share : t.save}</button
					>
					<button
						type="button"
						class="min-h-11 rounded-xl bg-red-700 px-4 font-medium hover:not-disabled:bg-red-800 active:bg-red-800"
						onclick={remove}>{t.delete}</button
					>
					<button
						type="button"
						class="min-h-11 rounded-xl bg-white px-4 font-medium text-black hover:not-disabled:bg-gray-200 active:bg-gray-200"
						onclick={close}>{t.close}</button
					>
				</div>
				<p
					class="min-h-6 px-3 pb-3 text-center text-sm"
					aria-live="polite"
					data-testid="viewer-notice"
				>
					{notice}
				</p>
			</div>
		{/if}
	</dialog>
{/if}
