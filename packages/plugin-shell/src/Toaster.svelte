<script lang="ts">
	/**
	 * The toasts from `app.toast()`, in the shell's notification stack. While `@xcwds/plugin-lock`
	 * has the app locked, one raised on a page it keeps out shows `privateText` instead.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { untrack } from 'svelte';
	import type { Toast } from './client.js';
	import { href } from './paths.js';

	let { privateText = 'Private page' }: { privateText?: string } = $props();
	const app = useApp();
	const shell = app.shell;
	let toasts = $state<readonly Toast[]>([]);
	$effect(() => shell?.toasts.subscribe((list) => (toasts = list)));

	/** What this uses of `app.lock` (from `@xcwds/plugin-lock`, if present). */
	type LockLike = {
		subscribe(listener: () => void): () => void;
		hides(path: string | undefined): boolean;
	};
	const lock = (app as { lock?: LockLike }).lock;
	// Bumped when the lock locks or unlocks, so messages are checked again.
	let version = $state(0);
	// Untracked: the first call runs inside the effect, which mustn't depend on what it writes.
	$effect(() => lock?.subscribe(() => untrack(() => void version++)));
	/** A toast raised on a page the locked app keeps out says only that it's private. */
	const message = (t: Toast) => {
		void version;
		return lock?.hides(t.path) ? privateText : t.message;
	};
</script>

<!-- Always rendered so screen readers pick up new messages in this live region. -->
<div
	role="status"
	aria-live="polite"
	class="flex w-full max-w-md flex-col items-center gap-2 md:items-end"
>
	{#each toasts as t (t.id)}
		{#if t.action}
			<div
				data-testid="toast"
				class="flex items-center gap-1 rounded-full bg-(--xcwds-toast-bg) py-1 pr-1 pl-1 text-sm font-medium text-(--xcwds-toast-fg) shadow-lg"
			>
				<button
					type="button"
					class="min-h-11 rounded-full pr-1 pl-3"
					onclick={() => shell?.toasts.dismiss(t.id)}>{message(t)}</button
				>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a
					href={`${href(t.action.path)}${t.action.hash ?? ''}`}
					class="flex min-h-11 items-center rounded-full px-3 font-semibold underline"
					onclick={() => shell?.toasts.dismiss(t.id)}>{t.action.label}</a
				>
			</div>
		{:else}
			<button
				type="button"
				data-testid="toast"
				class="min-h-11 rounded-full bg-(--xcwds-toast-bg) px-4 py-2 text-sm font-medium text-(--xcwds-toast-fg) shadow-lg"
				onclick={() => shell?.toasts.dismiss(t.id)}
			>
				{message(t)}
			</button>
		{/if}
	{/each}
</div>
