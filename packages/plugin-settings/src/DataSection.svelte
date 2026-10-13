<script lang="ts">
	/**
	 * Your data: download, share or import a backup of everything the app saved, and clear it per
	 * storage group (named and ordered by the `groups` option) or all at once (ported from
	 * xcwds.github.io's Settings). While a passcode lock (`app.lock`, from `@xcwds/plugin-lock`)
	 * is locked, none of it is offered: a backup would hand over what the lock keeps out.
	 */
	import type { Group, ParsedBackup } from '@xcwds/core';
	import { brand, useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import type {} from '@xcwds/plugin-shell/client';
	import type {} from './client.js';
	import { backupFileName, backupNote, orderGroups } from './options.js';

	const app = useApp();
	const storage = app.storage;
	const name = app.settingsPage?.options.backupName ?? 'backup';
	const toast = (message: string) => app.toast?.(message);

	let groups = $state<Group[]>([]);
	// Bumped on every change to saved data, so "has data" checks storage again.
	let version = $state(0);
	let writable = $state(true);
	let canShareFiles = $state(false);
	let pending = $state<Extract<ParsedBackup, { ok: true }> | null>(null);
	let importError = $state('');
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

	const hasData = (group: Group) => {
		void version;
		return group.entries.some((e) => storage.read(e) !== undefined);
	};
	const anyData = $derived(groups.some(hasData));

	onMount(() => {
		groups = orderGroups(storage.groups(), app.settingsPage?.options.groups ?? {});
		writable = storage.writable();
		try {
			canShareFiles = navigator.canShare?.({ files: [backupFile()] }) ?? false;
		} catch {
			canShareFiles = false;
		}
		const bump = () => void version++;
		// Other tabs, this tab's clears and imports, and settings changed on this page.
		const stops = [storage.onChange(bump), app.settings.subscribe(bump)];
		return () => stops.forEach((stop) => stop());
	});

	function backupFile() {
		const now = new Date();
		return new File(
			[JSON.stringify(storage.exportData(now), null, '\t')],
			backupFileName(name, now),
			{
				type: 'application/json'
			}
		);
	}

	function download() {
		const file = backupFile();
		const url = URL.createObjectURL(file);
		const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		toast('Backup downloaded.');
	}

	async function share() {
		try {
			await navigator.share({ files: [backupFile()], title: `${brand.name} backup` });
			toast('Backup shared.');
		} catch {
			// Share sheet dismissed.
		}
	}

	async function chooseFile(event: Event & { currentTarget: HTMLInputElement }) {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = '';
		importError = '';
		pending = null;
		if (!file) return;
		const parsed = storage.parseBackup(await file.text());
		if (parsed.ok) pending = parsed;
		else importError = parsed.error;
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

	function clearGroup(group: Group) {
		if (!confirm(`Clear saved data for ${group.label}?`)) return;
		storage.clear(group.entries);
		version++;
		toast(`Cleared ${group.label}.`);
	}

	function clearAll() {
		if (!confirm('Clear all data saved by this app on this device? This cannot be undone.')) return;
		storage.clear();
		version++;
		toast('All data cleared.');
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
			{:else}
				<p class="text-sm">It has no data this app can use.</p>
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
			{@const note = backupNote(group.entries)}
			<li class="flex items-center justify-between gap-3">
				<span class="flex flex-col">
					{group.label}
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
