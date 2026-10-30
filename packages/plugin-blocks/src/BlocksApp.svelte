<script lang="ts">
	/**
	 * Runs one of your apps (#160): the page at `<path>/app#<id>`, or `<path>/private#<id>` with
	 * `private` for private apps. Render it from those routes' files, inside `<main class="page-narrow">`:
	 *
	 * ```svelte
	 * <BlocksApp />            <!-- src/routes/my-apps/app/+page.svelte -->
	 * <BlocksApp private />    <!-- src/routes/my-apps/private/+page.svelte -->
	 * ```
	 *
	 * The app's id is in the fragment, so it never reaches a server. An app opened on the wrong
	 * one of the two pages goes to the right one; an id that isn't on this device says so, and the
	 * private page with no id (where Your apps sends you to unlock sealed private apps, #265) goes
	 * back to Your apps once unlocked. The
	 * header shows the app's name (`app.shell.setTitle`; a private page's `<title>` stays the
	 * route's). While `app.lock` is locked, a private app shows nothing.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import BlockList from './blocks/BlockList.svelte';
	import type { AppData, BlockData } from './data.js';
	import type { AppDefinition } from './format.js';
	import type {} from './client.js';
	import { go, href } from './navigate.js';
	import { button } from './ui.js';

	let { private: personal = false }: { private?: boolean } = $props();

	const app = useApp();
	const blocks = app.blocks;
	type ShellLike = { setTitle(text: string | undefined): void };
	type LockLike = {
		readonly state: { readonly locked: boolean };
		subscribe(listener: (state: { readonly locked: boolean }) => void): () => void;
	};
	const lock = (app as { lock?: LockLike }).lock;

	/** Undefined until the page has read the fragment, so the prerendered page matches. */
	let loaded = $state(false);
	let definition = $state.raw<AppDefinition>();
	let data = $state.raw<AppData>();
	let locked = $state(false);
	/** "Now", for what's due today and counters' days: moves on each minute and when the page shows. */
	let now = $state(Date.now());

	function load() {
		if (!blocks) return;
		let id = '';
		try {
			id = decodeURIComponent(location.hash.slice(1));
		} catch {
			// A malformed fragment names no app.
		}
		if (!id && personal && !locked) {
			void go(blocks.path, true);
			return;
		}
		const found = id ? blocks.get(id) : undefined;
		if (found && found.private !== personal) {
			// On the wrong page: the private one locks, and the normal one would leave it in history.
			void go(blocks.pathOf(found), true);
			return;
		}
		if (!found && id && !personal && blocks.lockedCount()) {
			// Maybe one of the private apps the vault keeps sealed: its page asks for the passcode.
			void go(blocks.pathOf({ id, private: true }), true);
			return;
		}
		definition = found;
		data = found ? blocks.data(found.id) : undefined;
		loaded = true;
		(app as { shell?: ShellLike }).shell?.setTitle(found?.name);
	}

	onMount(() => {
		// subscribe() calls back at once with the current state.
		const stopLock = personal ? lock?.subscribe((s) => (locked = s.locked)) : undefined;
		load();
		const tick = () => (now = Date.now());
		const timer = setInterval(tick, 60_000);
		document.addEventListener('visibilitychange', tick);
		addEventListener('hashchange', load);
		const stops = [blocks?.onChange(load), stopLock];
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', tick);
			removeEventListener('hashchange', load);
			for (const stop of stops) stop?.();
		};
	});

	/**
	 * Saves one block's data, starting from what's saved now. Tied to its app, so a save that
	 * lands after another app opened (a notes block's pending save) still goes to its own.
	 */
	function updater<T extends BlockData>(appId: string, blockId: string) {
		return (change: (current: T | undefined) => T): boolean => {
			if (!blocks) return false;
			const latest = blocks.data(appId);
			const next = change(latest.blocks[blockId] as T | undefined);
			const saved = blocks.saveData(appId, {
				...latest,
				blocks: { ...latest.blocks, [blockId]: next }
			});
			if (definition?.id === appId) data = blocks.data(appId);
			return saved;
		};
	}
</script>

{#if !blocks}
	<p>This app has no <code>@xcwds/plugin-blocks</code>.</p>
{:else if loaded && !locked}
	{#if !definition}
		<div class="flex flex-col items-start gap-3" data-testid="blocks-missing">
			<p>This app isn't on this device.</p>
			<a href={href(blocks.path)} class="{button} flex items-center">Your apps</a>
		</div>
	{:else}
		<!-- Keyed: another app gets new blocks, never this one's (or its pending saves). -->
		{#key definition.id}
			<div class="flex flex-col gap-6" data-testid="blocks-app" data-app-id={definition.id}>
				<BlockList
					app={definition}
					{data}
					{now}
					update={(blockId) => updater(definition!.id, blockId)}
				/>
				<a
					href={href(blocks.editPathOf(definition))}
					class="{button} flex items-center self-start"
					data-testid="blocks-edit">Edit app</a
				>
			</div>
		{/key}
	{/if}
{/if}
