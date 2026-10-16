<script lang="ts">
	/**
	 * The viewfinder (`@xcwds/plugin-camera`): a live picture from `app.camera`, a shutter, a
	 * front/back switch when there are two cameras, and the zoom and light the camera has.
	 *
	 * ```svelte
	 * <Camera onCapture={(photo) => save(photo.blob)} />
	 * ```
	 *
	 * Nothing asks for the camera until "Turn on camera" is tapped. Leaving the page turns it off.
	 * Without hardware zoom the slider is a digital zoom, labelled so: it crops the picture, and
	 * the photo is that same crop; pinching the picture zooms too. A blocked camera says where
	 * this browser keeps the setting that unblocks it. While `onCapture` runs (saving the photo),
	 * app updates wait.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';
	import { blockedHelp, pinchZoom, thisDevice } from './help.js';
	import {
		SAVING,
		type Camera as Controller,
		type CameraState,
		type Capabilities,
		type Photo
	} from './client.js';

	type Text = {
		start: string;
		stop: string;
		shutter: string;
		switchCamera: string;
		zoom: string;
		digitalZoom: string;
		digitalHint: string;
		light: string;
		asking: string;
		saving: string;
		missing: string;
	};
	const defaults: Text = {
		start: 'Turn on camera',
		stop: 'Turn off camera',
		shutter: 'Take photo',
		switchCamera: 'Switch camera',
		zoom: 'Zoom',
		digitalZoom: 'Digital zoom',
		digitalHint: 'Crops the picture; it adds no detail.',
		light: 'Light',
		asking: 'Waiting for permission to use the camera…',
		saving: 'Saving…',
		missing: "This app doesn't have the camera plugin."
	};

	let {
		onCapture,
		camera: given,
		text = {}
	}: {
		/** Gets each photo, a metadata-free image. App updates wait until it settles. */
		onCapture?: (photo: Photo) => void | Promise<void>;
		/** The controller to show; `app.camera` by default. */
		camera?: Controller;
		text?: Partial<Text>;
	} = $props();
	const t = $derived({ ...defaults, ...text });

	const app = useApp();
	const uid = $props.id();
	const camera = $derived(given ?? app.camera);

	/** Undefined until mounted, so the prerendered page matches the first render. */
	let status = $state<CameraState>();
	let error = $state('');
	let stream = $state.raw<MediaStream | null>(null);
	let mirrored = $state(false);
	let caps = $state.raw<Capabilities>({ zoom: null, torch: false, torchOn: false });
	let count = $state(0);
	let saving = $state(false);
	/** `onCapture` is running (the photo is taken and encoded). */
	let handing = false;
	let message = $state('');
	let video: HTMLVideoElement | undefined = $state();

	const live = $derived(status === 'live');
	const zoom = $derived(caps.zoom);
	/** Digital zoom scales the picture to show the crop the photo will be. */
	const scale = $derived(zoom?.kind === 'digital' ? zoom.value : 1);

	onMount(() => {
		const c = camera;
		if (!c) return;
		const read = () => {
			status = c.state;
			error = c.error;
			stream = c.stream;
			mirrored = c.facing === 'user';
			caps = c.capabilities();
		};
		read();
		const stop = c.onChange(read);
		// While `onCapture` saves a photo, an app update would lose it (`@xcwds/plugin-update`). The
		// plugin holds updates while the photo is taken; this covers the rest.
		const update = (app as { update?: { markBusy(name: string, busy: () => boolean): () => void } })
			.update;
		const unmark = update?.markBusy(SAVING, () => handing);
		return () => {
			stop();
			unmark?.();
			// Leaving the page turns the camera off, once a photo being taken is done (stopping the
			// track now would lose it before it reaches `onCapture`).
			if (!c.capturing) return c.stop();
			const wait = c.onChange(() => {
				if (c.capturing) return;
				wait();
				c.stop();
			});
		};
	});

	/** The picture has a frame: until then the shutter would have nothing to take. */
	let ready = $state(false);
	$effect(() => {
		if (!video) return;
		video.srcObject = stream;
		ready = false;
		if (stream) void video.play().catch(() => {});
	});

	// How many cameras there are, for the switch. Labels need permission; the count doesn't, but
	// some browsers only report every camera once one is allowed.
	$effect(() => {
		if (!live || !camera) return;
		void camera.cameras().then((n) => (count = n));
	});

	async function start() {
		message = '';
		await camera?.start();
	}

	async function shoot() {
		if (!camera || !live || !ready || saving || camera.capturing) return;
		message = '';
		saving = true;
		try {
			const result = await camera.capture(video);
			if (!result.ok) {
				message = result.error;
				return;
			}
			handing = true;
			await onCapture?.(result.photo);
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
			handing = false;
		}
	}

	function onZoom(event: Event) {
		void camera?.setZoom(Number((event.currentTarget as HTMLInputElement).value));
	}

	/** Where to unblock the camera in this browser, once it's blocked (read in the page only). */
	const help = $derived(status === 'denied' ? blockedHelp(thisDevice()) : '');

	// Pinch to zoom: two fingers on the picture set the same zoom as the slider.
	/** Fingers on the picture, by pointer id. Not reactive: only the zoom they set is shown. */
	const pointers: Record<number, { x: number; y: number }> = {};
	const fingers = () => Object.keys(pointers).length;
	let pinch: { from: number; start: number } | null = null;
	const spread = () => {
		const [a, b] = Object.values(pointers);
		return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
	};
	function pointerDown(event: PointerEvent) {
		if (!live || !zoom) return;
		pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
		if (fingers() === 2) pinch = { from: spread(), start: zoom.value };
	}
	function pointerMove(event: PointerEvent) {
		if (!(event.pointerId in pointers)) return;
		pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
		if (!pinch || !zoom || fingers() !== 2) return;
		const next = pinchZoom(pinch.start, pinch.from, spread(), zoom);
		if (next !== zoom.value) void camera?.setZoom(next);
	}
	function pointerUp(event: PointerEvent) {
		delete pointers[event.pointerId];
		if (fingers() < 2) pinch = null;
	}
</script>

<div class="flex flex-col gap-3" data-testid="camera">
	<div
		class="relative overflow-hidden rounded-xl bg-black"
		data-state={status}
		data-zoom={zoom?.kind}
		style:touch-action={live && zoom ? 'none' : undefined}
		onpointerdown={pointerDown}
		onpointermove={pointerMove}
		onpointerup={pointerUp}
		onpointercancel={pointerUp}
		role="presentation"
	>
		<video
			bind:this={video}
			class="block h-auto w-full origin-center"
			class:hidden={!live}
			style:transform="scale({mirrored ? -scale : scale}, {scale})"
			playsinline
			muted
			autoplay
			onloadeddata={() => (ready = true)}
			aria-label="Camera picture"
		></video>
		{#if !live}
			<div class="flex aspect-[4/3] w-full items-center justify-center p-4 text-center text-white">
				{#if status === 'asking'}
					<p>{t.asking}</p>
				{:else if camera}
					<button
						type="button"
						class="min-h-11 rounded-xl bg-white px-4 font-medium text-black hover:not-disabled:bg-gray-200 active:bg-gray-200"
						onclick={start}
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

	<p id="{uid}-status" class="text-sm text-red-700 dark:text-red-400" aria-live="polite">
		{message ||
			(status === 'denied' || status === 'unavailable' || status === 'error' ? error : '')}
	</p>
	{#if help}
		<p class="text-sm" data-testid="camera-help">{help}</p>
	{/if}

	{#if live}
		<div class="flex flex-wrap items-center justify-center gap-3">
			{#if count > 1}
				<button
					type="button"
					class="min-h-11 rounded-xl bg-(--xcwds-shell-card) px-4 font-medium hover:not-disabled:bg-(--xcwds-shell-hover-bg) active:bg-(--xcwds-shell-hover-bg)"
					onclick={() => camera?.switchFacing()}
					disabled={saving}
				>
					{t.switchCamera}
				</button>
			{/if}
			<button
				type="button"
				class="size-16 rounded-full border-4 border-(--xcwds-shell-accent) bg-white font-medium text-black hover:not-disabled:bg-gray-200 active:bg-gray-200 disabled:opacity-40"
				onclick={shoot}
				disabled={saving || !ready}
				aria-describedby="{uid}-status"
			>
				<span class="sr-only">{saving ? t.saving : t.shutter}</span>
				<span aria-hidden="true">{saving ? '…' : ''}</span>
			</button>
			{#if caps.torch}
				<label class="flex min-h-11 items-center gap-2 px-2 font-medium">
					<input
						type="checkbox"
						class="size-5"
						checked={caps.torchOn}
						onchange={(e) => camera?.setTorch(e.currentTarget.checked)}
					/>
					{t.light}
				</label>
			{/if}
			<button
				type="button"
				class="min-h-11 rounded-xl bg-(--xcwds-shell-card) px-4 font-medium hover:not-disabled:bg-(--xcwds-shell-hover-bg) active:bg-(--xcwds-shell-hover-bg)"
				onclick={() => camera?.stop()}
				disabled={saving}
			>
				{t.stop}
			</button>
		</div>
		{#if zoom}
			<div class="flex flex-col gap-1">
				<label for="{uid}-zoom" class="font-medium">
					{zoom.kind === 'digital' ? t.digitalZoom : t.zoom}
					<span class="tabular-nums">{zoom.value.toFixed(1)}×</span>
				</label>
				<input
					id="{uid}-zoom"
					type="range"
					class="min-h-11 w-full"
					min={zoom.min}
					max={zoom.max}
					step={zoom.step}
					value={zoom.value}
					oninput={onZoom}
					aria-describedby={zoom.kind === 'digital' ? `${uid}-zoom-hint` : undefined}
				/>
				{#if zoom.kind === 'digital'}
					<p id="{uid}-zoom-hint" class="text-sm text-(--xcwds-shell-muted)">{t.digitalHint}</p>
				{/if}
			</div>
		{/if}
	{/if}
</div>
