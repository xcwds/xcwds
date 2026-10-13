<script lang="ts">
	/**
	 * Settings → Privacy for `@xcwds/plugin-lock` (the `lock` field): the app-switcher cover, and
	 * the passcode lock (set up, what it locks, auto-lock, lock now, change, turn off, forgot).
	 * While locked, only unlocking and "Forgot passcode" are offered.
	 */
	import { settings, useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import type { LockState } from './client.js';
	import Forgot from './Forgot.svelte';
	import { href } from './navigate.js';
	import {
		AUTO_LOCK_MINUTES,
		DEFAULT_LOCK,
		type AutoLockMinutes,
		type LockScope,
		type LockSetting
	} from './options.js';
	import type { PasscodeKind } from './passcode.js';
	import { passcodeAttributes, toast, ui, waitText } from './ui.js';

	let { name = 'lock' }: { name?: string } = $props();
	const app = useApp();
	const uid = $props.id();
	const value = $derived((settings.current[name] as LockSetting | undefined) ?? DEFAULT_LOCK);
	const set = (patch: Partial<LockSetting>) => settings.set({ [name]: { ...value, ...patch } });

	/** Undefined until mounted, so the prerendered page matches the first render. */
	let lock = $state.raw<LockState>();
	onMount(() => app.lock?.subscribe((state) => (lock = state)));

	const scopes: { value: LockScope; label: string }[] = [
		{ value: 'private', label: 'Private pages' },
		{ value: 'app', label: 'The whole app' }
	];
	const minutesLabel = (m: AutoLockMinutes) => (m === 0 ? 'Right away' : `${m} min`);
	const locks = $derived(value.scope === 'app' ? 'the whole app' : 'private pages');

	/** Which form is open. */
	let form = $state<'setup' | 'change' | 'off' | null>(null);
	let kind = $state<PasscodeKind>('digits');
	let current = $state('');
	let next = $state('');
	let again = $state('');
	let error = $state('');
	let busy = $state(false);

	function open(which: typeof form) {
		form = which;
		kind = lock?.kind ?? 'digits';
		current = next = again = error = '';
	}

	/** What a try with the current passcode said, as a sentence (or '' when it worked). */
	function problem(result: string): string {
		if (result === 'ok') return '';
		if (result === 'wrong') return 'Wrong passcode.';
		if (result === 'wait')
			return `Too many wrong tries. Try again in ${waitText((lock?.retryAt ?? 0) - Date.now())}.`;
		return result;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const l = app.lock;
		if (!l || busy) return;
		if (form !== 'off' && next !== again) {
			error = "The passcodes don't match.";
			return;
		}
		busy = true;
		error = '';
		try {
			if (form === 'setup') {
				const result = await l.setUp(next, kind);
				if (result) return void (error = result);
				toast(app, `Passcode set. It locks ${locks}.`);
			} else if (form === 'change') {
				const result = problem(await l.change(current, next, kind));
				if (result) return void (error = result);
				toast(app, 'Passcode changed.');
			} else if (form === 'off') {
				const result = problem(await l.turnOff(current));
				if (result) return void (error = result);
				toast(app, 'Passcode lock turned off.');
			}
			form = null;
			current = next = again = '';
		} finally {
			busy = false;
		}
	}

	function lockNow() {
		app.lock?.lock();
		// With the whole app locked, the unlock screen replaces this page.
		if (value.scope === 'private') toast(app, 'Locked.');
	}

	/** A backup before setting up, in case the passcode is forgotten (not encrypted yet, #79). */
	function backup() {
		const now = new Date();
		const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
			.map((n) => String(n).padStart(2, '0'))
			.join('-');
		const base =
			(app as { settingsPage?: { options: { backupName: string } } }).settingsPage?.options
				.backupName ?? 'backup';
		const file = new File(
			[JSON.stringify(app.storage.exportData(now), null, '\t')],
			`${base}-${date}.json`,
			{ type: 'application/json' }
		);
		const url = URL.createObjectURL(file);
		Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		toast(app, 'Backup downloaded.');
	}
</script>

{#snippet passcode(id: string, label: string, bind: 'current' | 'next' | 'again', as: PasscodeKind)}
	<label for="{uid}-{id}" class="font-medium">{label}</label>
	{#if bind === 'current'}
		<input id="{uid}-{id}" class={ui.field} bind:value={current} {...passcodeAttributes(as)} />
	{:else if bind === 'next'}
		<input id="{uid}-{id}" class={ui.field} bind:value={next} {...passcodeAttributes(as)} />
	{:else}
		<input id="{uid}-{id}" class={ui.field} bind:value={again} {...passcodeAttributes(as)} />
	{/if}
{/snippet}

{#snippet newPasscode()}
	<fieldset class="flex flex-col gap-1">
		<legend class="sr-only">Kind of passcode</legend>
		<div class="flex flex-wrap gap-2">
			{#each [['digits', '6+ digits'], ['passphrase', 'A passphrase (8+ characters)']] as [k, text] (k)}
				<label
					class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-(--xcwds-shell-border) px-3"
				>
					<input
						type="radio"
						name="{uid}-kind"
						value={k}
						checked={kind === k}
						onchange={() => (kind = k as PasscodeKind)}
					/>
					{text}
				</label>
			{/each}
		</div>
	</fieldset>
	{@render passcode('next', form === 'setup' ? 'Passcode' : 'New passcode', 'next', kind)}
	{@render passcode('again', 'Same again', 'again', kind)}
{/snippet}

<div class="flex flex-col gap-4" data-testid="lock-settings">
	<label class="flex min-h-11 items-center justify-between gap-3">
		<span class="flex flex-col">
			<span class="font-medium">Cover private pages in the app switcher</span>
			<span class={ui.muted}>
				Best effort: browsers don't promise when they take the snapshot. Typing on private pages
				never uses spellcheck or autocomplete.
			</span>
		</span>
		<input
			type="checkbox"
			role="switch"
			class="size-6 shrink-0"
			checked={value.cover}
			disabled={!settings.ready}
			onchange={(e) => set({ cover: e.currentTarget.checked })}
		/>
	</label>

	<section class="flex flex-col gap-3" aria-labelledby="{uid}-lock" data-testid="passcode-lock">
		<h3 id="{uid}-lock" class="font-medium">Passcode lock</h3>
		{#if lock && !lock.enabled}
			<p class={ui.muted}>
				Lock private pages, or the whole app, with a passcode. Every reload starts locked.
			</p>
			{#if form !== 'setup'}
				<button type="button" class="{ui.primary} self-start" onclick={() => open('setup')}>
					Set a passcode
				</button>
			{/if}
		{:else if lock?.locked}
			<p data-testid="lock-status">
				Locked.
				<a
					class="inline-flex min-h-11 items-center px-1 font-medium underline"
					href={href(app.lockScreen?.path ?? '/unlock')}>Unlock</a
				>
			</p>
			<Forgot />
		{:else if lock}
			<p data-testid="lock-status">The passcode lock is on and unlocked.</p>
			<fieldset class="flex flex-col gap-1">
				<legend class="font-medium">What it locks</legend>
				<div class="flex flex-wrap gap-2">
					{#each scopes as scope (scope.value)}
						<label
							class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-(--xcwds-shell-border) px-3"
						>
							<input
								type="radio"
								name="{uid}-scope"
								checked={value.scope === scope.value}
								disabled={!settings.ready}
								onchange={() => set({ scope: scope.value })}
							/>
							{scope.label}
						</label>
					{/each}
				</div>
			</fieldset>
			<fieldset class="flex flex-col gap-1">
				<legend class="font-medium">Lock after the app is hidden for</legend>
				<div class="flex flex-wrap gap-2">
					{#each AUTO_LOCK_MINUTES as minutes (minutes)}
						<label
							class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-(--xcwds-shell-border) px-3"
						>
							<input
								type="radio"
								name="{uid}-auto"
								checked={value.autoLockMinutes === minutes}
								disabled={!settings.ready}
								onchange={() => set({ autoLockMinutes: minutes })}
							/>
							{minutesLabel(minutes)}
						</label>
					{/each}
				</div>
			</fieldset>
			{#if !form}
				<div class="flex flex-wrap gap-2">
					<button type="button" class={ui.primary} onclick={lockNow}>Lock now</button>
					<button type="button" class={ui.secondary} onclick={() => open('change')}>
						Change passcode
					</button>
					<button type="button" class={ui.secondary} onclick={() => open('off')}>Turn off</button>
				</div>
			{/if}
		{/if}

		{#if form && lock && !lock.locked}
			<form class="flex flex-col gap-2" onsubmit={submit} data-testid="lock-form">
				{#if form === 'setup'}
					<p class="text-sm">
						A forgotten passcode can't be recovered: resetting the lock clears what it protects.
						Download a backup first; it isn't encrypted, so keep it somewhere safe.
					</p>
					<button type="button" class="{ui.secondary} self-start" onclick={backup}>
						Download a backup (unencrypted)
					</button>
				{/if}
				{#if form !== 'setup'}
					{@render passcode('current', 'Current passcode', 'current', lock.kind ?? 'digits')}
				{/if}
				{#if form !== 'off'}{@render newPasscode()}{/if}
				<p class={ui.error} aria-live="polite" data-testid="lock-error">{error}</p>
				<div class="flex flex-wrap gap-2">
					<button type="submit" class={form === 'off' ? ui.danger : ui.primary} disabled={busy}>
						{busy
							? 'Checking…'
							: form === 'setup'
								? 'Save passcode'
								: form === 'change'
									? 'Change passcode'
									: 'Turn off'}
					</button>
					<button type="button" class={ui.secondary} onclick={() => (form = null)}>Cancel</button>
				</div>
			</form>
		{/if}

		<p class={ui.muted}>
			The lock keeps people out of {locks}; it doesn't encrypt what's saved on this device, and
			there's no way to recover a forgotten passcode.
		</p>
	</section>
</div>
