<script lang="ts">
	/**
	 * What's new: the latest entries, with a New badge on those the user hadn't seen when it
	 * opened (none on a fresh install). Showing it marks them seen. The settings plugin puts it
	 * on its page; place it inside `<App>` to show it elsewhere.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import { SECTION_ID } from './client.js';

	let { title = "What's new" }: { title?: string } = $props();
	const uid = $props.id();

	const changelog = useApp().changelog;
	const entries = changelog?.entries ?? [];
	/** Entries above this get a badge for this visit; it stays put once they're marked seen. */
	let seenBefore = $state(changelog?.latest ?? 0);

	onMount(() => {
		if (!changelog) return;
		seenBefore = changelog.seen();
		changelog.markSeen();
	});

	const day = (date: string) =>
		new Date(`${date}T12:00`).toLocaleDateString(undefined, { dateStyle: 'medium' });
</script>

{#if entries.length}
	<section
		id={SECTION_ID}
		class="flex scroll-mt-20 flex-col gap-3 rounded-2xl bg-(--xcwds-shell-card) p-4"
		aria-labelledby="{uid}-title"
		data-testid="whats-new"
	>
		<h2 id="{uid}-title" class="text-lg font-semibold">{title}</h2>
		<ol class="flex flex-col gap-3 text-sm">
			{#each entries as entry (entry.id)}
				<li data-testid="whats-new-entry">
					<p class="flex items-center gap-2 text-(--xcwds-shell-muted)">
						<time datetime={entry.date}>{day(entry.date)}</time>
						{#if entry.id > seenBefore}
							<span
								data-testid="whats-new-badge"
								class="rounded-full bg-(--xcwds-shell-accent) px-2 text-xs font-semibold text-white"
							>
								New
							</span>
						{/if}
					</p>
					<ul class="list-disc pl-5">
						{#each entry.items as item, i (i)}
							<li>{item}</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ol>
	</section>
{/if}
