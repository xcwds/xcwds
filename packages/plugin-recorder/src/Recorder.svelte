<script lang="ts" module>
	/** `m:ss`, or `h:mm:ss` from an hour. */
	export function clock(ms: number): string {
		const s = Math.max(0, Math.floor(ms / 1000));
		const pad = (n: number) => String(n).padStart(2, '0');
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
	}
</script>

<script lang="ts">
	/**
	 * The recorder's controls (`@xcwds/plugin-recorder`): Record, then Pause or Resume, Stop
	 * (saves) and Discard, with the time recorded and a level meter.
	 *
	 * ```svelte
	 * <Recorder />
	 * ```
	 *
	 * Nothing asks for the microphone until Record is tapped. The recording belongs to the app,
	 * not the page: leaving the page keeps it going, and coming back shows it again. When it stops
	 * on its own (the microphone was cut off, or the app locked), it says why.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import type { Recorder as Controller, RecorderState } from './client.js';

	type Text = {
		record: string;
		pause: string;
		resume: string;
		stop: string;
		discard: string;
		cancel: string;
		asking: string;
		saving: string;
		saved: string;
		discarded: string;
		paused: string;
		level: string;
		missing: string;
	};
	const defaults: Text = {
		record: 'Record',
		pause: 'Pause',
		resume: 'Resume',
		stop: 'Stop and save',
		discard: 'Discard',
		cancel: 'Cancel',
		asking: 'Waiting for permission to use the microphone…',
		saving: 'Saving…',
		saved: 'Recording saved.',
		discarded: 'Recording discarded.',
		paused: 'Paused',
		level: 'Microphone level',
		missing: "This app doesn't have the recorder plugin."
	};

	let {
		recorder: given,
		text = {}
	}: {
		/** The recorder to show; `app.recorder` by default. */
		recorder?: Controller;
		text?: Partial<Text>;
	} = $props();
	const t = $derived({ ...defaults, ...text });

	const app = useApp();
	const recorder = $derived(given ?? app.recorder);

	/** Undefined until mounted, so the prerendered page matches the first render. */
	let status = $state<RecorderState>();
	let error = $state('');
	let notice = $state('');
	let saving = $state(false);
	let elapsed = $state(0);
	let level = $state(0);
	/** What the last Stop or Discard here came to. */
	let message = $state('');

	const running = $derived(status === 'recording' || status === 'paused');
	const button =
		'min-h-11 rounded-xl px-4 font-medium disabled:opacity-40 bg-(--xcwds-shell-card) hover:not-disabled:bg-(--xcwds-shell-hover-bg) active:bg-(--xcwds-shell-hover-bg)';

	onMount(() => {
		const r = recorder;
		if (!r) return;
		let frame = 0;
		const tick = () => {
			elapsed = r.elapsed();
			level = r.level();
			frame = r.state === 'recording' ? requestAnimationFrame(tick) : 0;
		};
		const read = () => {
			status = r.state;
			error = r.error;
			notice = r.notice;
			saving = r.saving;
			if (notice) message = '';
			cancelAnimationFrame(frame);
			tick();
		};
		read();
		const stop = r.onChange(read);
		return () => {
			stop();
			cancelAnimationFrame(frame);
		};
	});

	async function start() {
		message = '';
		await recorder?.start();
	}
	async function stop() {
		const result = await recorder?.stop();
		if (result) message = result.ok ? t.saved : result.error;
	}
	async function discard() {
		const was = running;
		await recorder?.discard();
		if (was) message = t.discarded;
	}
</script>

<div class="flex flex-col items-center gap-4" data-state={status} data-testid="recorder">
	{#if !recorder}
		<p>{t.missing}</p>
	{:else if status !== undefined}
		<p
			class="font-mono text-5xl tabular-nums"
			class:opacity-60={status === 'paused'}
			data-testid="recorder-time"
		>
			{clock(elapsed)}
		</p>
		<div
			class="h-2 w-full max-w-xs overflow-hidden rounded-full bg-(--xcwds-shell-card)"
			role="meter"
			aria-label={t.level}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(level * 100)}
		>
			<div
				class="h-full rounded-full bg-(--xcwds-shell-accent) transition-[width] duration-75"
				style:width="{Math.round(level * 100)}%"
			></div>
		</div>
		<div class="flex flex-wrap justify-center gap-2">
			{#if status === 'asking'}
				<button type="button" class={button} onclick={() => recorder?.stop()}>{t.cancel}</button>
			{:else if running}
				{#if status === 'recording'}
					<button type="button" class={button} onclick={() => recorder?.pause()}>{t.pause}</button>
				{:else}
					<button type="button" class={button} onclick={() => recorder?.resume()}>{t.resume}</button
					>
				{/if}
				<button
					type="button"
					class="min-h-11 rounded-xl bg-(--xcwds-shell-accent) px-4 font-medium text-white hover:not-disabled:opacity-90 active:opacity-90"
					onclick={stop}>{t.stop}</button
				>
				<button type="button" class={button} onclick={discard}>{t.discard}</button>
			{:else}
				<button
					type="button"
					class="min-h-11 rounded-xl bg-red-700 px-6 font-medium text-white hover:not-disabled:bg-red-800 active:bg-red-800 disabled:opacity-40"
					onclick={start}
					disabled={saving}>{saving ? t.saving : t.record}</button
				>
			{/if}
		</div>
		<p class="min-h-11 text-center text-sm" aria-live="polite" data-testid="recorder-status">
			{#if status === 'asking'}
				{t.asking}
			{:else if status === 'paused'}
				{t.paused}
			{:else if error}
				<span class="text-red-700 dark:text-red-400">{error}</span>
			{:else}
				{notice || message}
			{/if}
		</p>
	{/if}
</div>
