<script lang="ts">
	/**
	 * Says when the page showing belongs to an app that's off (an old bookmark, a shared link), with
	 * a button that turns it back on. The page itself still works. Put it in the shell's `notices`.
	 */
	import { page } from '$app/state';
	import { appPath, settings, useApp } from '@xcwds/sveltekit';
	import type { AppGroup } from './options.js';
	import type {} from './types.js';

	const app = useApp();
	const tools = app.tools;
	let off = $state<AppGroup | undefined>();
	const path = $derived(appPath(page.url.pathname) ?? '/');
	$effect(() => {
		const here = path;
		return tools?.subscribe(() => {
			const a = tools.appOf(here);
			off = a && !tools.isOn(a.id) ? a : undefined;
		});
	});
	/** What this uses of `app.lock` (from `@xcwds/plugin-lock`, if present). */
	type LockLike = { subscribe(listener: (state: { locked: boolean }) => void): () => void };
	let locked = $state(false);
	$effect(() => (app as { lock?: LockLike }).lock?.subscribe((state) => (locked = state.locked)));
	// Not before settings load (it would read the defaults), and never a private app's name over
	// the unlock screen.
	const shown = $derived(off && settings.ready && !(off.private && locked) ? off : undefined);

	function turnOn(a: AppGroup) {
		if (tools?.setOn(a.id, true)) app.toast?.(`${a.name} turned on.`);
	}
</script>

{#if shown}
	<div
		class="flex items-center justify-between gap-3 rounded-xl bg-(--xcwds-shell-card) px-4 py-2 shadow"
		role="status"
		data-testid="app-off"
	>
		<span>{shown.emoji} {shown.name} is turned off.</span>
		<button
			type="button"
			class="min-h-11 rounded-xl bg-(--xcwds-shell-accent) px-3 font-semibold text-white"
			onclick={() => turnOn(shown)}>Turn on</button
		>
	</div>
{/if}
