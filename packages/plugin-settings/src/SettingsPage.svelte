<script lang="ts">
	/**
	 * The settings page: every settings field with a `control` (or a component a plugin added for
	 * it), grouped by section, the sections plugins add (Install, What's new), Your data
	 * (backups and clearing), Privacy (the servers it contacts, #22) and About, in two columns on
	 * wide screens with `width: 'split'`. Render it from the settings route; `about` adds the
	 * app's own lines to About.
	 */
	import { version } from '$app/environment';
	import type { FieldInfo } from '@xcwds/core';
	import { brand, useApp } from '@xcwds/sveltekit';
	import type { Snippet } from 'svelte';
	import type { FieldComponent, PageSection } from './client.js';
	import DataSection from './DataSection.svelte';
	import FieldControl from './FieldControl.svelte';
	import PrivacySection from './PrivacySection.svelte';
	import { sectionOrder, sectionTitle } from './options.js';

	let { about }: { about?: Snippet } = $props();
	const uid = $props.id();

	const app = useApp();
	const page = app.settingsPage;
	const titles = page?.options.sections ?? {};
	const split = page?.options.width === 'split';
	let added = $state.raw<readonly PageSection[]>(page?.sections() ?? []);
	let controls = $state.raw<ReadonlyMap<string, FieldComponent>>(new Map(page?.controls()));
	$effect(() =>
		page?.subscribe(() => {
			added = page.sections();
			controls = new Map(page.controls());
		})
	);

	const fields = app.settings.fields();
	const shown = $derived(fields.filter((f) => f.control || controls.has(f.name)));
	const groups = $derived.by(() => {
		// Fields in the `privacy` section go in the built-in Privacy card instead.
		const ids = sectionOrder(
			shown.map((f) => f.section).filter((id) => id !== 'privacy'),
			titles
		);
		return ids.map((id) => ({ id, fields: shown.filter((f) => f.section === id) }));
	});

	/**
	 * Built-ins and plugin sections in one order: fields at 0, Your data 100, Privacy 150,
	 * About 200.
	 */
	type Block =
		| { kind: 'fields'; order: number }
		| { kind: 'data'; order: number }
		| { kind: 'privacy'; order: number }
		| { kind: 'about'; order: number }
		| { kind: 'added'; order: number; section: PageSection };
	const blocks = $derived(
		[
			{ kind: 'fields', order: 0 },
			{ kind: 'data', order: 100 },
			{ kind: 'privacy', order: 150 },
			{ kind: 'about', order: 200 },
			...added.map((section) => ({ kind: 'added', order: section.order, section }) as const)
		].sort((a, b) => a.order - b.order) as Block[]
	);

	const built = /^\d+$/.test(version)
		? new Date(Number(version)).toLocaleString(undefined, {
				dateStyle: 'medium',
				timeStyle: 'short'
			})
		: version;

	const privacyFields = $derived(shown.filter((f) => f.section === 'privacy'));

	const card = 'flex flex-col gap-3 rounded-2xl bg-(--xcwds-shell-card) p-4';
	const control = (f: FieldInfo) => controls.get(f.name);
</script>

<!-- With `width: 'split'`, two balanced columns of cards once the container is 50rem wide. -->
<div class={split ? '@container' : ''}>
	<div
		class="flex flex-col gap-6 {split
			? '@[50rem]:block @[50rem]:columns-2 @[50rem]:gap-10 @[50rem]:*:mb-6 @[50rem]:*:break-inside-avoid'
			: ''}"
		data-testid="settings-page"
	>
		{#each blocks as block (block.kind === 'added' ? block.section : block.kind)}
			{#if block.kind === 'fields'}
				{#each groups as group (group.id)}
					<section
						class={card}
						aria-labelledby="{uid}-{group.id}"
						data-testid="settings-{group.id}"
					>
						<h2 id="{uid}-{group.id}" class="text-lg font-semibold">
							{sectionTitle(group.id, titles)}
						</h2>
						{#each group.fields as field (field.name)}
							{@const Custom = control(field)}
							{#if Custom}<Custom name={field.name} />{:else}<FieldControl {field} />{/if}
						{/each}
					</section>
				{/each}
			{:else if block.kind === 'data'}
				<section class={card} aria-labelledby="{uid}-data">
					<h2 id="{uid}-data" class="text-lg font-semibold">Your data</h2>
					<DataSection />
				</section>
			{:else if block.kind === 'privacy'}
				<section class={card} aria-labelledby="{uid}-privacy" data-testid="settings-privacy">
					<h2 id="{uid}-privacy" class="text-lg font-semibold">Privacy</h2>
					{#each privacyFields as field (field.name)}
						{@const Custom = control(field)}
						{#if Custom}<Custom name={field.name} />{:else}<FieldControl {field} />{/if}
					{/each}
					<PrivacySection />
				</section>
			{:else if block.kind === 'about'}
				<section class={card} aria-labelledby="{uid}-about" data-testid="about">
					<h2 id="{uid}-about" class="text-lg font-semibold">About</h2>
					<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
						<dt class="text-(--xcwds-shell-muted)">{brand.name}</dt>
						<dd>{brand.tagline}</dd>
						<dt class="text-(--xcwds-shell-muted)">Version</dt>
						<dd data-testid="version">{built}</dd>
						{#if page?.options.source}
							<dt class="text-(--xcwds-shell-muted)">Source</dt>
							<dd>
								<a class="underline" href={page.options.source} rel="external noopener"
									>{page.options.source.replace(/^https:\/\//, '')}</a
								>
							</dd>
						{/if}
					</dl>
					{@render about?.()}
				</section>
			{:else}
				<block.section.component {...block.section.props} />
			{/if}
		{/each}
	</div>
</div>
