<script lang="ts">
	/**
	 * A live QR scanner (`@xcwds/plugin-qr`) over the camera from `@xcwds/plugin-camera`
	 * (`app.camera`): the viewfinder, read a few times a second on the device.
	 *
	 * ```svelte
	 * <QrScanner onResult={(found) => show(found)} />
	 * ```
	 *
	 * Nothing asks for the camera until "Scan a code" is tapped. The first code found goes to
	 * `onResult` (never opened or followed: the page decides) and turns the camera off, unless
	 * `continuous`; the phone vibrates once where it can. Leaving the page turns the camera off,
	 * and so do a hidden page or a locked app (the camera plugin's rules). Frames are read with
	 * `BarcodeDetector` where it reads the format, else the bundled decoder in a Worker, which goes
	 * away with the scanner.
	 */
	import type {} from '@xcwds/plugin-camera/client';
	import type { Camera as Controller, CameraState } from '@xcwds/plugin-camera/client';
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import { createReader, type BarcodeFormat, type Reader, type ScanResult } from './scan.js';

	type Text = { start: string; stop: string; scanning: string; asking: string; missing: string };
	const defaults: Text = {
		start: 'Scan a code',
		stop: 'Stop scanning',
		scanning: 'Point the camera at a code.',
		asking: 'Waiting for permission to use the camera…',
		missing: "This app doesn't have the camera plugin."
	};

	let {
		onResult,
		formats = ['qr_code'],
		continuous = false,
		interval = 250,
		camera: given,
		text = {}
	}: {
		/** Gets each code found: once, unless `continuous` (then once per new code). */
		onResult?: (result: ScanResult) => void;
		/** What to look for. Default `['qr_code']`; others only where `BarcodeDetector` has them. */
		formats?: BarcodeFormat[];
		/** Keep scanning after a code (the same code isn't reported again while it stays in view). */
		continuous?: boolean;
		/** Milliseconds between reads; default 250. */
		interval?: number;
		/** The camera to use; `app.camera` by default. */
		camera?: Controller;
		text?: Partial<Text>;
	} = $props();

	const t = $derived({ ...defaults, ...text });
	const app = useApp();
	const camera = $derived(given ?? app.camera);

	let status = $state<CameraState>();
	let error = $state('');
	let stream = $state<MediaStream | null>(null);
	let video: HTMLVideoElement | undefined = $state();
	let ready = $state(false);
	const live = $derived(status === 'live');

	onMount(() => {
		const c = camera;
		if (!c) return;
		const read = () => {
			status = c.state;
			error = c.error;
			stream = c.stream;
		};
		read();
		const stop = c.onChange(read);
		return () => {
			stop();
			c.stop();
		};
	});

	$effect(() => {
		if (!video) return;
		video.srcObject = stream;
		ready = false;
		if (stream) void video.play().catch(() => {});
	});

	// The reading loop: one frame at a time, `interval` apart, while the picture is live.
	$effect(() => {
		if (!live || !ready || !video || !camera) return;
		const v = video;
		const c = camera;
		const reader: Reader = createReader({ formats, maxSide: 640 });
		let running = true;
		/** The last code reported and when it was last seen, so `continuous` reports it once. */
		let last: { text: string; seen: number } | undefined;
		let timer: ReturnType<typeof setTimeout>;
		const tick = async () => {
			if (!running) return;
			const found = v.readyState >= 2 ? await reader.read(v).catch(() => null) : null;
			if (!running) return;
			const now = Date.now();
			if (found && !(last?.text === found.text && now - last.seen < 2000)) {
				navigator.vibrate?.(50);
				if (!continuous) {
					running = false;
					c.stop();
				}
				onResult?.(found);
			}
			if (found) last = { text: found.text, seen: now };
			if (running) timer = setTimeout(tick, interval);
		};
		timer = setTimeout(tick, interval);
		return () => {
			running = false;
			clearTimeout(timer);
			reader.close();
		};
	});
</script>

<div class="flex flex-col gap-3" data-testid="qr-scanner">
	<div class="relative overflow-hidden rounded-xl bg-black" data-state={status}>
		<video
			bind:this={video}
			class="block h-auto w-full"
			class:hidden={!live}
			playsinline
			muted
			autoplay
			onloadeddata={() => (ready = true)}
			aria-label="Camera picture"
		></video>
		{#if live}
			<div class="xcwds-qr-line" aria-hidden="true"></div>
		{:else}
			<div class="flex aspect-[4/3] w-full items-center justify-center p-4 text-center text-white">
				{#if status === 'asking'}
					<p>{t.asking}</p>
				{:else if camera}
					<button
						type="button"
						class="min-h-11 rounded-xl bg-white px-4 font-medium text-black hover:not-disabled:bg-gray-200 active:bg-gray-200"
						onclick={() => camera?.start()}
						disabled={status === undefined}
					>
						{t.start}
					</button>
				{:else}
					<p>{t.missing}</p>
				{/if}
			</div>
		{/if}
	</div>
	<p class="text-sm" aria-live="polite">
		{#if live}{t.scanning}{:else if status === 'denied' || status === 'unavailable' || status === 'error'}<span
				class="text-red-700 dark:text-red-400">{error}</span
			>{/if}
	</p>
	{#if live}
		<button
			type="button"
			class="min-h-11 self-start rounded-xl bg-(--xcwds-shell-card) px-4 font-medium hover:not-disabled:bg-(--xcwds-shell-hover-bg) active:bg-(--xcwds-shell-hover-bg)"
			onclick={() => camera?.stop()}
		>
			{t.stop}
		</button>
	{/if}
</div>

<style>
	/* A line sweeping the picture while it scans; still for people who ask for less motion. */
	.xcwds-qr-line {
		position: absolute;
		inset-inline: 10%;
		top: 10%;
		height: 2px;
		background: rgb(255 255 255 / 0.8);
		box-shadow: 0 0 8px rgb(255 255 255 / 0.8);
		animation: xcwds-qr-sweep 2s ease-in-out infinite alternate;
	}
	@keyframes xcwds-qr-sweep {
		to {
			top: 90%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.xcwds-qr-line {
			animation: none;
			top: 50%;
		}
	}
</style>
