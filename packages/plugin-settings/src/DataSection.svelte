<script lang="ts">
	/**
	 * Your data: download, share or import a backup of everything the app saved, and clear it per
	 * storage group (named and ordered by the `groups` option) or all at once (ported from
	 * xcwds.github.io's Settings). A group's files (`app.blobs` collections, #144) are counted under
	 * it and cleared with it; backups leave them out. While a passcode lock (`app.lock`, from `@xcwds/plugin-lock`)
	 * is locked, none of it is offered: a backup would hand over what the lock keeps out.
	 *
	 * With `@xcwds/plugin-vault`, backups carry the sensitive groups encrypted (format 3, #79), and
	 * importing one asks for the passcode it was made with to bring those back too.
	 */
	import type { Group, ParsedBackup, PrefixEntry } from '@xcwds/core';
	import { brand, useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import type {} from '@xcwds/plugin-shell/client';
	import type {} from './client.js';
	import { backupFileName, backupNote, filesNote, orderGroups } from './options.js';

	const app = useApp();
	const storage = app.storage;
	// A core before #144 has no blob store.
	const blobs = (app as { blobs?: typeof app.blobs }).blobs;
	const collectionsOf = (group: Group) => group.collections ?? [];
	const name = app.settingsPage?.options.backupName ?? 'backup';
	const toast = (message: string) => app.toast?.(message);

	let groups = $state<Group[]>([]);
	/** Each collection's files: how many and their total size, by collection key. */
	let files = $state.raw(new Map<string, { count: number; bytes: number }>());
	// Bumped on every change to saved data, so "has data" checks storage again.
	let version = $state(0);
	let writable = $state(true);
	let canShareFiles = $state(false);
	let pending = $state<Extract<ParsedBackup, { ok: true }> | null>(null);
	/** The chosen file's text, for opening its encrypted part. */
	let pendingText = '';
	let importError = $state('');
	/** `@xcwds/plugin-vault`'s `app.vault`, when the app has it. */
	type VaultLike = {
		openBackup(
			text: string,
			passcode: string
		): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
	};
	const vault = (app as { vault?: VaultLike }).vault;
	let passcode = $state('');
	let opening = $state(false);
	let openError = $state('');
	/** The groups the pending backup carries encrypted, by name ('' when it carries none). */
	const sealedGroups = $derived.by(() => {
		const section = pending?.backup.sections?.vault as { groups?: unknown } | undefined;
		if (!section || typeof section.groups !== 'object' || section.groups === null) return '';
		const ids = Object.keys(section.groups);
		// Named as under Clear data (the `groups` option, else the entries' labels).
		const labels = new Map(groups.map((g) => [g.id, g.label]));
		return ids.map((id) => labels.get(id) || id).join(', ');
	});
	let fileInput: HTMLInputElement | undefined = $state();
	/** What this page uses of `app.lock` (from `@xcwds/plugin-lock`, if present). */
	type LockLike = { subscribe(listener: (state: { locked: boolean }) => void): () => void };
	let locked = $state(false);
	onMount(() =>
		(app as { lock?: LockLike }).lock?.subscribe((state) => {
			locked = state.locked;
			if (locked) pending = null;
		})
	);

	/** What each of the group's collections holds, named when the group has more than one. */
	const groupFiles = (group: Group) => {
		const collections = collectionsOf(group);
		return collections.flatMap((c) => {
			const usage = files.get(c.key);
			const note = usage && filesNote(usage.count, usage.bytes);
			if (!note) return [];
			return [{ key: c.key, note: collections.length > 1 ? `${c.label}: ${note}` : note }];
		});
	};
	const hasData = (group: Group) => {
		void version;
		return (
			group.entries.some((e) =>
				// A prefixed entry (#157) has data when any of its ids is saved.
				e.prefix
					? storage.keys(e as PrefixEntry<unknown>).length > 0
					: storage.read(e) !== undefined
			) || groupFiles(group).length > 0
		);
	};

	/** Counts the files again; the latest call wins if several overlap. */
	let counting = 0;
	async function countFiles() {
		if (!blobs) return;
		const run = ++counting;
		const usage = await blobs.usage();
		if (run !== counting) return;
		files = new Map(usage.map((u) => [u.collection.key, { count: u.count, bytes: u.bytes }]));
	}
	const anyData = $derived(groups.some(hasData));

	onMount(() => {
		groups = orderGroups(storage.groups(), app.settingsPage?.options.groups ?? {});
		writable = storage.writable();
		try {
			const probe = new File(['{}'], backupFileName(name, new Date()), {
				type: 'application/json'
			});
			canShareFiles = navigator.canShare?.({ files: [probe] }) ?? false;
		} catch {
			canShareFiles = false;
		}
		const bump = () => void version++;
		// Other tabs, this tab's clears and imports, and settings changed on this page.
		const stops = [storage.onChange(bump), app.settings.subscribe(bump)];
		if (blobs) {
			void countFiles();
			stops.push(blobs.onChange(() => void countFiles()));
		}
		return () => stops.forEach((stop) => stop());
	});

	async function backupFile() {
		const now = new Date();
		// A core before #79 has no backup sections.
		const backup = storage.exportBackup ? await storage.exportBackup(now) : storage.exportData(now);
		return new File([JSON.stringify(backup, null, '\t')], backupFileName(name, now), {
			type: 'application/json'
		});
	}

	async function download() {
		const file = await backupFile();
		const url = URL.createObjectURL(file);
		const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		toast('Backup downloaded.');
	}

	async function share() {
		try {
			await navigator.share({ files: [await backupFile()], title: `${brand.name} backup` });
			toast('Backup shared.');
		} catch {
			// Share sheet dismissed.
		}
	}

	async function chooseFile(event: Event & { currentTarget: HTMLInputElement }) {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = '';
		importError = openError = passcode = '';
		pending = null;
		if (!file) return;
		pendingText = await file.text();
		const parsed = storage.parseBackup(pendingText);
		if (parsed.ok) pending = parsed;
		else importError = parsed.error;
	}

	/** Opens the backup's encrypted part with the passcode, then shows what it holds. */
	async function openSealed(event: SubmitEvent) {
		event.preventDefault();
		if (!vault || !pending || opening) return;
		opening = true;
		openError = '';
		try {
			const opened = await vault.openBackup(pendingText, passcode);
			if (!opened.ok) return void (openError = opened.error);
			const parsed = storage.parseBackup(opened.text);
			if (!parsed.ok) return void (openError = parsed.error);
			pendingText = opened.text;
			pending = parsed;
			passcode = '';
		} finally {
			opening = false;
		}
	}

	function apply(mode: 'replace' | 'merge') {
		if (!pending) return;
		const ok = storage.importData(pending.backup, mode);
		const count = pending.found.length;
		pending = null;
		version++;
		// A replace that doesn't fit puts the previous data back; a merge keeps what it saved.
		toast(
			ok
				? `Imported ${count} ${count === 1 ? 'item' : 'items'}.`
				: mode === 'replace'
					? "Couldn't import: storage is full or blocked. Your data is as it was."
					: 'Some data could not be saved (storage may be full or blocked).'
		);
	}

	/** Clears files; false if some couldn't be (IndexedDB blocked, or locked). */
	async function clearFiles(collections?: Group['collections']) {
		if (!blobs || collections?.length === 0) return true;
		const ok = await blobs.clear(collections);
		await countFiles();
		return ok;
	}

	async function clearGroup(group: Group) {
		if (!confirm(`Clear saved data for ${group.label}?`)) return;
		storage.clear(group.entries);
		version++;
		const ok = await clearFiles(collectionsOf(group));
		toast(
			ok
				? `Cleared ${group.label}.`
				: `Cleared ${group.label}, but some files couldn't be cleared. Try again.`
		);
	}

	async function clearAll() {
		if (!confirm('Clear all data saved by this app on this device? This cannot be undone.')) return;
		storage.clear();
		version++;
		const ok = await clearFiles();
		toast(
			ok ? 'All data cleared.' : "Data cleared, but some files couldn't be cleared. Try again."
		);
	}

	const button =
		'min-h-11 rounded-xl bg-(--xcwds-shell-card) px-3 py-2 font-medium hover:bg-(--xcwds-shell-hover-bg) disabled:opacity-40';
	const primary =
		'min-h-11 rounded-xl bg-(--xcwds-shell-accent) px-3 py-2 font-semibold text-white disabled:opacity-40';
	const muted = 'text-sm text-(--xcwds-shell-muted)';
</script>

<p class={muted}>
	Everything is saved only on this device. Back it up to move it to another phone or keep a copy.
</p>
{#if locked}
	<p class="text-sm" data-testid="data-locked">
		Locked. Unlock with your passcode to back up, import or clear your data.
	</p>
{:else}
	{#if !writable}
		<p class="text-sm text-amber-800 dark:text-amber-300" data-testid="storage-warning">
			This browser isn't letting {brand.name} save anything right now (storage is full, or site data is
			blocked). Changes last only until you close the app. If storage is full, download a backup, then
			clear data you don't need.
		</p>
	{/if}

	<div class="grid gap-2 {canShareFiles ? 'grid-cols-2' : 'grid-cols-1'}">
		<button type="button" class={primary} onclick={download}>Download backup</button>
		{#if canShareFiles}
			<button type="button" class={primary} onclick={share}>Share backup</button>
		{/if}
	</div>

	<input
		bind:this={fileInput}
		type="file"
		accept="application/json,.json"
		class="hidden"
		aria-label="Backup file"
		onchange={chooseFile}
	/>
	<button type="button" class={button} onclick={() => fileInput?.click()}>Import backup…</button>

	{#if importError}
		<p class="text-sm text-red-700 dark:text-red-400" role="alert">{importError}</p>
	{/if}

	{#if pending}
		<div
			class="flex flex-col gap-2 rounded-xl bg-(--xcwds-shell-card) p-3"
			data-testid="import-preview"
		>
			<p class="font-medium">
				Backup{pending.backup.exportedAt
					? ` from ${new Date(pending.backup.exportedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
					: ''}
			</p>
			{#if pending.found.length}
				<ul class="list-disc pl-5 text-sm">
					{#each pending.found as e (e.key)}
						<li>{e.label}</li>
					{/each}
				</ul>
			{:else if !sealedGroups}
				<p class="text-sm">It has no data this app can use.</p>
			{/if}
			{#if sealedGroups && vault}
				<form class="flex flex-col gap-2 text-sm" onsubmit={openSealed} data-testid="import-sealed">
					<label for="import-passcode">
						It also has <strong>{sealedGroups}</strong>, encrypted. Enter the passcode that was set
						when it was made to import that too; without it, only the rest is imported.
					</label>
					<div class="flex gap-2">
						<input
							id="import-passcode"
							class="min-h-11 min-w-0 flex-1 rounded-xl border border-(--xcwds-shell-border) bg-transparent px-3"
							type="password"
							autocomplete="off"
							spellcheck="false"
							bind:value={passcode}
						/>
						<button type="submit" class={button} disabled={!passcode || opening}>
							{opening ? 'Opening…' : 'Open'}
						</button>
					</div>
					{#if openError}
						<p class="text-red-700 dark:text-red-400" role="alert">{openError}</p>
					{/if}
				</form>
			{:else if sealedGroups}
				<p class="text-sm text-amber-800 dark:text-amber-300" data-testid="import-sealed">
					It also has encrypted data this app can't open; that part will be skipped.
				</p>
			{/if}
			{#if pending.skipped.length}
				<p class="text-sm text-amber-800 dark:text-amber-300">
					{pending.skipped.length} unrecognized or invalid {pending.skipped.length === 1
						? 'item'
						: 'items'} will be skipped.
				</p>
			{/if}
			<div class="grid grid-cols-2 gap-2 text-sm">
				<button
					type="button"
					class={primary}
					disabled={!pending.found.length}
					onclick={() => apply('merge')}>Merge</button
				>
				<button
					type="button"
					class={button}
					disabled={!pending.found.length}
					onclick={() => apply('replace')}>Replace everything</button
				>
			</div>
			<p class="text-xs text-(--xcwds-shell-muted)">
				Merge keeps data that isn't in the backup. Replace clears everything first.
			</p>
			<button type="button" class="{button} text-sm" onclick={() => (pending = null)}>Cancel</button
			>
		</div>
	{/if}

	<h3 class="mt-2 font-semibold">Clear data</h3>
	<ul class="flex flex-col gap-2">
		{#each groups as group (group.id)}
			{@const note = backupNote([...group.entries, ...collectionsOf(group)])}
			<li class="flex items-center justify-between gap-3">
				<span class="flex flex-col">
					{group.label}
					{#each groupFiles(group) as used (used.key)}
						<span class={muted} data-testid="files-note">{used.note}</span>
					{/each}
					{#if note}<span class={muted} data-testid="backup-note">{note}</span>{/if}
				</span>
				<button
					type="button"
					class="{button} text-sm"
					disabled={!hasData(group)}
					aria-label="Clear {group.label}"
					onclick={() => clearGroup(group)}>Clear</button
				>
			</li>
		{/each}
	</ul>
	<button
		type="button"
		class="min-h-11 rounded-xl bg-red-600 px-3 py-2 font-semibold text-white disabled:opacity-40"
		disabled={!anyData}
		onclick={clearAll}
	>
		Clear all data
	</button>
{/if}
