<script lang="ts" module>
	/** Whether this page load has said that a shared or saved recording is outside the app. */
	let told = false;
</script>

<script lang="ts">
	/**
	 * The recordings kept in the app (`@xcwds/plugin-recorder`), newest first, each with its name
	 * (or when it was recorded), date and length: Play, Rename, Share (or Save where files can't
	 * be shared) and Delete, which can be undone. Recordings recovered after the app closed
	 * mid-recording say so.
	 *
	 * ```svelte
	 * <Recordings />
	 * ```
	 *
	 * One plays at a time, from an object URL that's revoked when it stops being the one open and
	 * when the list goes. While `app.lock` (from `@xcwds/plugin-lock`) is locked, nothing is
	 * rendered and no object URL exists.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import type { RecordingMeta, SavedRecording } from './client.js';
	import type { Recordings as Store } from './recordings.js';
	import { clock } from './Recorder.svelte';
	import { SHARE_MESSAGES, canShareAudio, shareRecording } from './share.js';

	type Text = {
		label: string;
		empty: string;
		untitled: (date: string) => string;
		recovered: string;
		play: string;
		close: string;
		rename: string;
		name: string;
		saveName: string;
		cancel: string;
		share: string;
		save: string;
		delete: string;
		deleted: string;
		undo: string;
		outside: string;
		shareFailed: string;
		failed: string;
		renameFailed: string;
		missing: string;
	};
	const defaults: Text = {
		label: 'Recordings',
		empty: 'No recordings yet.',
		untitled: (date) => `Recording, ${date}`,
		recovered: 'Recovered',
		play: 'Play',
		close: 'Close',
		rename: 'Rename',
		name: 'Name',
		saveName: 'Save name',
		cancel: 'Cancel',
		share: 'Share',
		save: 'Save',
		delete: 'Delete',
		deleted: 'Recording deleted.',
		undo: 'Undo',
		outside: SHARE_MESSAGES.outside,
		shareFailed: SHARE_MESSAGES.failed,
		failed: "The recording couldn't be deleted. Try again.",
		renameFailed: "The name couldn't be saved. Try again.",
		missing: "This app doesn't keep recordings (no recorder plugin)."
	};

	let {
		recordings: given,
		text = {}
	}: {
		/** The store to show; `app.recordings` by default. */
		recordings?: Pick<Store, 'list' | 'get' | 'delete' | 'rename' | 'restore' | 'onChange'>;
		text?: Partial<Text>;
	} = $props();
	const t = $derived({ ...defaults, ...text });

	const app = useApp();
	const store = $derived(given ?? app.recordings);

	type LockLike = {
		readonly state: { readonly locked: boolean };
		subscribe(listener: (state: { readonly locked: boolean }) => void): () => void;
	};
	const lock = (app as { lock?: LockLike }).lock;
	let locked = $state(lock?.state.locked ?? false);

	/** Undefined until listed, so the prerendered page matches the first render. */
	let list = $state.raw<SavedRecording[]>();
	/** The recording open (playing), its file and object URL. */
	let open = $state.raw<{ id: string; blob: Blob; url: string } | null>(null);
	let opening = 0;
	/** The recording being renamed, and the name typed so far. */
	let renaming = $state<string | null>(null);
	let draft = $state('');
	let busy = $state(false);
	/** The recording `rename` is saving under a new id. */
	let moving: string | null = null;
	/** Share (the share sheet takes files) or Save (a download). Read in the page only. */
	let shares = $state(false);
	let sharing = $state(false);
	let message = $state('');
	/** The last deleted recording, until Undo times out. */
	let undo = $state.raw<{
		blob: Blob;
		meta: RecordingMeta;
		timer: ReturnType<typeof setTimeout>;
	} | null>(null);

	const date = (ms: number) =>
		new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	const title = (r: SavedRecording) => r.name || t.untitled(date(r.recordedAt));
	const button =
		'min-h-11 rounded-xl bg-(--xcwds-shell-card) px-4 font-medium hover:not-disabled:bg-(--xcwds-shell-hover-bg) active:bg-(--xcwds-shell-hover-bg) disabled:opacity-40';

	let listing = 0;
	async function refresh() {
		if (!store || locked) return;
		const run = ++listing;
		const next = await store.list();
		if (run !== listing || locked) return;
		list = next;
		const ids = new Set(next.map((r) => r.id));
		// One being renamed is saved under a new id: it stays open.
		if (open && !ids.has(open.id) && open.id !== moving) shut();
		if (renaming && !ids.has(renaming)) renaming = null;
	}

	function shut() {
		opening++;
		if (open) URL.revokeObjectURL(open.url);
		open = null;
	}

	async function play(r: SavedRecording) {
		if (!store) return;
		message = '';
		if (open?.id === r.id) return shut();
		shut();
		const run = opening;
		const got = await store.get(r.id);
		if (run !== opening || locked) return;
		if (!got) return void refresh();
		open = { id: r.id, blob: got.blob, url: URL.createObjectURL(got.blob) };
	}

	function startRename(r: SavedRecording) {
		message = '';
		renaming = r.id;
		draft = r.name;
	}
	async function rename(event: SubmitEvent) {
		event.preventDefault();
		const id = renaming;
		if (!store || !id || busy) return;
		busy = true;
		try {
			const name = draft.trim();
			const current = list?.find((r) => r.id === id);
			if (current && current.name === name) {
				renaming = null;
				return;
			}
			moving = id;
			let saved: string | false;
			try {
				saved = await store.rename(id, name);
				// Its id changed: keep it playing under the new one.
				if (saved !== false && open?.id === id) open = { ...open, id: saved };
			} finally {
				moving = null;
			}
			if (saved === false) {
				message = t.renameFailed;
				return;
			}
			if (renaming === id) renaming = null;
		} finally {
			busy = false;
		}
	}

	async function remove(r: SavedRecording) {
		if (!store || busy) return;
		busy = true;
		message = '';
		try {
			const got = await store.get(r.id);
			if (!(await store.delete(r.id))) {
				message = t.failed;
				return;
			}
			if (undo) clearTimeout(undo.timer);
			undo =
				got && !locked
					? {
							blob: got.blob,
							meta: {
								name: r.name,
								recordedAt: r.recordedAt,
								duration: r.duration,
								...(r.recovered ? { recovered: true as const } : {})
							},
							timer: setTimeout(() => (undo = null), 8000)
						}
					: null;
			if (!undo) message = t.deleted;
		} finally {
			busy = false;
		}
	}
	async function restore() {
		if (!store || !undo) return;
		const { blob, meta, timer } = undo;
		clearTimeout(timer);
		undo = null;
		if ((await store.restore(blob, meta)) === false) message = t.failed;
	}

	/** The recording leaves the app only here, on the person's tap. */
	async function share(r: SavedRecording) {
		if (open?.id !== r.id || sharing) return;
		message = '';
		sharing = true;
		const outcome = await shareRecording({
			blob: open.blob,
			name: r.name,
			recordedAt: r.recordedAt
		}).finally(() => (sharing = false));
		if (outcome === 'failed') message = t.shareFailed;
		else if (outcome !== 'cancelled' && !told) {
			told = true;
			message = t.outside;
		}
	}

	onMount(() => {
		shares = canShareAudio();
		const stopLock = lock?.subscribe((state) => {
			if (state.locked === locked) return;
			locked = state.locked;
			if (locked) {
				// A lock's reset may clear the recordings: Undo must not bring one back.
				if (undo) clearTimeout(undo.timer);
				undo = null;
				renaming = null;
				message = '';
				shut();
				list = undefined;
			} else void refresh();
		});
		void refresh();
		const stop = store?.onChange(() => void refresh());
		return () => {
			stopLock?.();
			stop?.();
			if (undo) clearTimeout(undo.timer);
			shut();
		};
	});
</script>

{#if !locked}
	<div class="flex flex-col gap-3" data-testid="recordings">
		{#if !store}
			<p>{t.missing}</p>
		{:else if list && list.length === 0}
			<p class="text-(--xcwds-shell-muted)">{t.empty}</p>
		{:else if list}
			<ul class="flex flex-col gap-2" aria-label={t.label}>
				{#each list as r (r.id)}
					<li class="flex flex-col gap-2 rounded-xl bg-(--xcwds-shell-card) p-3">
						{#if renaming === r.id}
							<form class="flex flex-wrap items-center gap-2" onsubmit={rename}>
								<!-- svelte-ignore a11y_autofocus -->
								<input
									class="min-h-11 min-w-0 flex-1 rounded-xl border border-(--xcwds-shell-border) bg-transparent px-3"
									aria-label={t.name}
									maxlength="200"
									bind:value={draft}
									autofocus
								/>
								<button type="submit" class={button} disabled={busy}>{t.saveName}</button>
								<button type="button" class={button} onclick={() => (renaming = null)}
									>{t.cancel}</button
								>
							</form>
						{:else}
							<div class="flex flex-wrap items-baseline justify-between gap-x-3">
								<span class="font-medium break-words">{title(r)}</span>
								<span class="text-sm text-(--xcwds-shell-muted) tabular-nums">
									{#if r.recovered}{t.recovered} ·
									{/if}{r.name ? `${date(r.recordedAt)} · ` : ''}{clock(r.duration)}
								</span>
							</div>
						{/if}
						{#if open?.id === r.id}
							<audio class="w-full" src={open.url} controls autoplay data-testid="player"></audio>
						{/if}
						<div class="flex flex-wrap gap-2">
							<button
								type="button"
								class={button}
								onclick={() => play(r)}
								aria-expanded={open?.id === r.id}
								aria-label="{open?.id === r.id ? t.close : t.play} {title(r)}"
								>{open?.id === r.id ? t.close : t.play}</button
							>
							{#if open?.id === r.id}
								<button type="button" class={button} onclick={() => share(r)} disabled={sharing}
									>{shares ? t.share : t.save}</button
								>
							{/if}
							{#if renaming !== r.id}
								<button
									type="button"
									class={button}
									onclick={() => startRename(r)}
									aria-label="{t.rename} {title(r)}">{t.rename}</button
								>
							{/if}
							<button
								type="button"
								class="min-h-11 rounded-xl px-4 font-medium text-red-700 hover:not-disabled:bg-(--xcwds-shell-hover-bg) active:bg-(--xcwds-shell-hover-bg) disabled:opacity-40 dark:text-red-400"
								onclick={() => remove(r)}
								disabled={busy}
								aria-label="{t.delete} {title(r)}">{t.delete}</button
							>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
		<p
			class="flex min-h-11 items-center gap-3 text-sm"
			aria-live="polite"
			data-testid="recordings-status"
		>
			{#if undo}
				{t.deleted}
				<button type="button" class={button} onclick={restore}>{t.undo}</button>
			{:else}
				{message}
			{/if}
		</p>
	</div>
{/if}
