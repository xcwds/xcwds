<script lang="ts">
	/**
	 * The unlock screen (`@xcwds/plugin-lock`): asks for the passcode, then goes on to the page
	 * that was asked for. Mount it from the unlock route file:
	 *
	 * ```svelte
	 * <main class="page-narrow pt-2"><UnlockScreen /></main>
	 * ```
	 *
	 * "Forgot passcode" resets the lock and clears what it protects. It offers no backup: a
	 * backup made while locked would hand over what the lock keeps out.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { onMount, tick } from 'svelte';
	import type { LockState } from './client.js';
	import Forgot from './Forgot.svelte';
	import { go } from './navigate.js';
	import { passcodeAttributes, ui, waitText } from './ui.js';

	type Text = { heading: string; intro: string; label: string; unlock: string; wrong: string };
	const defaults: Text = {
		heading: 'Locked',
		intro: 'Enter your passcode to open this page.',
		label: 'Passcode',
		unlock: 'Unlock',
		wrong: 'Wrong passcode.'
	};
	let { text = {} }: { text?: Partial<Text> } = $props();
	const t = $derived({ ...defaults, ...text });

	const app = useApp();
	const uid = $props.id();
	/** Undefined until mounted, so the prerendered page matches the first render. */
	let lock = $state.raw<LockState>();
	let code = $state('');
	let error = $state('');
	let busy = $state(false);
	let now = $state(Date.now());
	let input: HTMLInputElement | undefined = $state();
	const waiting = $derived(lock !== undefined && lock.retryAt > now);

	onMount(() => {
		const stop = app.lock?.subscribe((state) => (lock = state));
		void tick().then(() => input?.focus());
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => {
			stop?.();
			clearInterval(timer);
		};
	});

	// Unlocked here, in another way (a reset) or never locked: on to the page that was asked for.
	let leaving = false;
	$effect(() => {
		if (!lock || lock.locked || leaving) return;
		leaving = true;
		void go(app.lockScreen?.next() ?? '/', true);
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!app.lock || busy || !code) return;
		busy = true;
		error = '';
		try {
			const result = await app.lock.unlock(code);
			now = Date.now();
			if (result === 'wrong') error = t.wrong;
			if (result !== 'ok') {
				code = '';
				input?.focus();
			}
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex flex-col gap-4" data-testid="unlock">
	<p>{t.intro}</p>
	<form class="flex flex-col gap-2" onsubmit={submit}>
		<label for="{uid}-code" class="font-medium">{t.label}</label>
		<input
			id="{uid}-code"
			class={ui.field}
			bind:this={input}
			bind:value={code}
			{...passcodeAttributes(lock?.kind ?? 'digits')}
			disabled={!lock?.locked || waiting}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby="{uid}-status"
		/>
		<p id="{uid}-status" class={waiting ? ui.muted : ui.error} aria-live="polite">
			{#if waiting && lock}
				Too many wrong tries. Try again in {waitText(lock.retryAt - now)}.
			{:else}
				{error}
			{/if}
		</p>
		<button
			type="submit"
			class="{ui.primary} self-start"
			disabled={!lock?.locked || waiting || busy}
		>
			{busy ? 'Checking…' : t.unlock}
		</button>
	</form>
	{#if lock?.locked}<Forgot />{/if}
</div>
