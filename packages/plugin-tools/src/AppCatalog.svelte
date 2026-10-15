<script lang="ts">
	/**
	 * The Apps page (#158): one card per app with the tools in it and an On/Off switch. Turning an
	 * app off only hides it from Home and the index page; its pages still open and its data stays.
	 * An app that's off and has saved data offers Remove data. Render it from the Apps page's
	 * route file, inside `<main class="page-wide">`.
	 */
	import type { Group, PrefixEntry } from '@xcwds/core';
	import { useApp } from '@xcwds/sveltekit';
	import type { AppGroup } from './options.js';
	import type {} from './types.js';

	const app = useApp();
	const tools = app.tools;
	const apps = tools?.apps() ?? [];
	let on = $state<Record<string, boolean>>({});
	$effect(() =>
		tools?.subscribe(() => (on = Object.fromEntries(apps.map((a) => [a.id, tools.isOn(a.id)]))))
	);

	/** What this page uses of `app.lock` (from `@xcwds/plugin-lock`, if present). */
	type LockLike = { subscribe(listener: (state: { locked: boolean }) => void): () => void };
	let locked = $state(false);
	$effect(() => (app as { lock?: LockLike }).lock?.subscribe((state) => (locked = state.locked)));

	/** Bumped when data changes (here or in another tab), so "has data" is checked again. */
	let version = $state(0);
	const blobs = (app as { blobs?: typeof app.blobs }).blobs;
	/** Files saved per blob collection key. */
	let files = $state.raw(new Map<string, number>());
	let counting = 0;
	async function countFiles() {
		if (!blobs) return;
		const run = ++counting;
		const usage = await blobs.usage();
		if (run === counting) files = new Map(usage.map((u) => [u.collection.key, u.count]));
	}
	$effect(() => {
		const stops = [app.storage.onChange(() => version++)];
		if (blobs) {
			void countFiles();
			stops.push(blobs.onChange(() => void countFiles()));
		}
		return () => stops.forEach((stop) => stop());
	});

	const groupsOf = (a: AppGroup): Group[] => {
		const ids = new Set(a.groups ?? []);
		return app.storage.groups().filter((g) => ids.has(g.id));
	};
	function hasData(a: AppGroup): boolean {
		void version;
		return groupsOf(a).some(
			(g) =>
				g.collections.some((c) => (files.get(c.key) ?? 0) > 0) ||
				g.entries.some((e) =>
					e.prefix
						? app.storage.keys(e as PrefixEntry<unknown>).length > 0
						: app.storage.read(e) !== undefined
				)
		);
	}

	function toggle(a: AppGroup) {
		const next = !on[a.id];
		if (tools?.setOn(a.id, next)) app.toast?.(`${a.name} turned ${next ? 'on' : 'off'}.`);
	}

	async function removeData(a: AppGroup) {
		const groups = groupsOf(a);
		const what = groups.map((g) => g.label).join('; ');
		if (!confirm(`Remove ${a.name}'s saved data (${what}) from this device? This can't be undone.`))
			return;
		app.storage.clear(groups.flatMap((g) => g.entries));
		const collections = groups.flatMap((g) => g.collections);
		const ok = blobs && collections.length ? await blobs.clear(collections) : true;
		version++;
		await countFiles();
		app.toast?.(
			ok ? `Removed ${a.name}'s data.` : `Removed ${a.name}'s data, but some files couldn't be.`
		);
	}

	const button =
		'min-h-11 rounded-xl bg-(--xcwds-shell-card) px-3 py-2 text-sm font-medium hover:bg-(--xcwds-shell-hover-bg) disabled:opacity-40';
</script>

<p class="text-sm text-(--xcwds-shell-muted)">
	Turn on the apps you use. Turning one off hides it from Home and the list of tools; its pages
	still open and nothing saved is lost.
</p>
<ul class="grid gap-2 md:grid-cols-2 lg:grid-cols-3" data-testid="apps">
	{#each apps as a (a.id)}
		{@const names = tools?.all().filter((t) => t.app === a.id) ?? []}
		<li
			class="flex flex-col gap-2 rounded-xl bg-(--xcwds-shell-card) px-4 py-3"
			data-testid="app-card"
		>
			<div class="flex items-start gap-3">
				<span aria-hidden="true" class="text-2xl">{a.emoji}</span>
				<span class="flex flex-1 flex-col">
					<span class="font-medium" id="xcwds-app-{a.id}">{a.name}</span>
					<span class="text-sm text-(--xcwds-shell-muted)">{a.blurb}</span>
					{#if names.length}
						<span class="text-sm text-(--xcwds-shell-muted)">
							{names.map((t) => `${t.emoji} ${t.name}`).join(' · ')}
						</span>
					{/if}
				</span>
				<button
					type="button"
					role="switch"
					aria-checked={on[a.id] ?? false}
					aria-labelledby="xcwds-app-{a.id}"
					class="xcwds-app-switch min-h-11 min-w-16 shrink-0 rounded-full px-3 text-sm font-semibold {on[
						a.id
					]
						? 'bg-(--xcwds-shell-accent) text-white'
						: 'bg-(--xcwds-shell-hover-bg)'}"
					onclick={() => toggle(a)}
				>
					{on[a.id] ? 'On' : 'Off'}
				</button>
			</div>
			{#if on[a.id] === false && hasData(a)}
				<div class="flex justify-end">
					<button
						type="button"
						class={button}
						disabled={locked}
						aria-label="Remove {a.name}'s data"
						onclick={() => removeData(a)}>Remove data</button
					>
				</div>
			{/if}
		</li>
	{/each}
</ul>
