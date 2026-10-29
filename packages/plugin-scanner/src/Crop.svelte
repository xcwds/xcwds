<script lang="ts">
	/**
	 * The crop screen (`@xcwds/plugin-scanner`): a photo with four corner handles on the page,
	 * a filter, and Add page, which straightens the page and saves it to `app.scanner`.
	 *
	 * ```svelte
	 * <Crop photo={photo.blob} onDone={() => (photo = undefined)} />
	 * ```
	 *
	 * The handles start on the page `findPage` finds (in the scanner's Worker), or on the photo's
	 * corners when it finds none, and say which. Drag a handle, or focus it and use the arrow keys (Shift for bigger
	 * steps). Corners that cross say so beside the photo, and Add page waits until they make a page.
	 * Pass `retake` to replace that page instead of adding one.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import type { Scanner } from './client.js';
	import {
		CORNERS,
		cropProblem,
		describePoint,
		moveCorner,
		nudge,
		readPhoto,
		READ_ERROR,
		toPhoto
	} from './crop.js';
	import type { Filter } from './filters.js';
	import { rectangle, type Paper, type Quad } from './geometry.js';
	import type { Pixels } from './warp.js';

	type Text = {
		loading: string;
		finding: string;
		found: string;
		notFound: string;
		hint: string;
		corner: string;
		filter: string;
		original: string;
		greyscale: string;
		bw: string;
		reset: string;
		add: string;
		replace: string;
		saving: string;
		cancel: string;
		missing: string;
	};
	const defaults: Text = {
		loading: 'Opening the photo…',
		finding: 'Looking for the page…',
		found: 'Found the page. Move the corners if they’re off.',
		notFound: 'Couldn’t find the page. Move the corners to its corners.',
		hint: 'Drag, or use the arrow keys; Shift moves further.',
		corner: 'corner',
		filter: 'Filter',
		original: 'Original',
		greyscale: 'Greyscale',
		bw: 'Black & white',
		reset: 'Reset corners',
		add: 'Add page',
		replace: 'Replace page',
		saving: 'Saving…',
		cancel: 'Cancel',
		missing: "This app doesn't have the scanner plugin."
	};

	let {
		photo,
		retake,
		max,
		filter = $bindable('original'),
		onDone,
		onCancel,
		scanner: given,
		text = {}
	}: {
		/** The photo to crop: a camera photo's `blob`, or an image file. */
		photo: Blob;
		/** The id of a page to replace, keeping its place, instead of adding one. */
		retake?: string;
		/** The longer side to open the photo at, at most: `OPEN_MAX` (4096 px) by default. */
		max?: number;
		/** The filter chosen, `original` by default; bind it to keep the choice between pages. */
		filter?: Filter;
		/** Called once the page is saved. */
		onDone?: (page: { id: string; paper: Paper | null }) => void;
		/** Shows a Cancel button that calls it. */
		onCancel?: () => void;
		/** The scanner to save to; `app.scanner` by default. */
		scanner?: Scanner;
		text?: Partial<Text>;
	} = $props();
	const t = $derived({ ...defaults, ...text });

	const app = useApp();
	const uid = $props.id();
	const scanner = $derived(given ?? app.scanner);

	/** Undefined while the photo opens, null when it couldn't be opened. */
	let pixels = $state.raw<Pixels | null>();
	let start = $state.raw<{ quad: Quad; found: boolean }>();
	let quad = $state.raw<Quad>();
	let saving = $state(false);
	let message = $state('');
	/** Where a keyboard move put a corner, for screen readers. */
	let moved = $state('');
	let canvas: HTMLCanvasElement | undefined = $state();
	let frame: HTMLDivElement | undefined = $state();

	// Opens each photo given and finds the page in it; a newer one replaces a photo still opening.
	$effect(() => {
		const given = photo;
		const largest = max;
		const finder = scanner;
		let current = true;
		pixels = undefined;
		start = undefined;
		quad = undefined;
		message = '';
		moved = '';
		readPhoto(given, largest === undefined ? {} : { max: largest }).then(
			(read) => {
				if (!current) return;
				pixels = read;
				if (!read || !finder) return;
				// Only a closed scanner rejects: then the handles start on the whole photo.
				const whole = { quad: rectangle(read.width, read.height), found: false };
				finder
					.startCorners(read)
					.catch(() => whole)
					.then((found) => {
						if (!current) return;
						start = found;
						quad = found.quad;
					});
			},
			(e: unknown) => {
				// A bad `max`.
				if (!current) return;
				pixels = null;
				message = e instanceof Error ? e.message : String(e);
			}
		);
		return () => {
			current = false;
		};
	});

	$effect(() => {
		if (!canvas || !pixels) return;
		canvas.width = pixels.width;
		canvas.height = pixels.height;
		canvas
			.getContext('2d')
			?.putImageData(
				new ImageData(pixels.data as Uint8ClampedArray<ArrayBuffer>, pixels.width, pixels.height),
				0,
				0
			);
	});

	const problem = $derived(quad ? cropProblem(quad) : '');
	const size = $derived(pixels ? { width: pixels.width, height: pixels.height } : undefined);

	/** The corner being dragged, and by which pointer. */
	let drag: { index: number; pointer: number } | null = null;

	function pointerDown(event: PointerEvent, index: number) {
		if (saving || (event.pointerType === 'mouse' && event.button !== 0)) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
		(event.currentTarget as HTMLElement).focus();
		drag = { index, pointer: event.pointerId };
	}
	function pointerMove(event: PointerEvent) {
		if (!drag || drag.pointer !== event.pointerId || !quad || !size || !frame) return;
		const point = toPhoto(
			{ x: event.clientX, y: event.clientY },
			frame.getBoundingClientRect(),
			size
		);
		quad = moveCorner(quad, drag.index, point, size);
	}
	function pointerUp(event: PointerEvent) {
		if (drag?.pointer === event.pointerId) drag = null;
	}
	function keyDown(event: KeyboardEvent, index: number) {
		if (saving || !quad || !size) return;
		const next = nudge(quad, index, event.key, size, event.shiftKey);
		if (!next) return;
		event.preventDefault();
		quad = next;
		moved = `${CORNERS[index]} ${t.corner}: ${describePoint(next[index]!, size)}`;
	}

	function reset() {
		if (start) quad = start.quad;
	}

	async function add() {
		if (!scanner || !pixels || !quad || problem || saving) return;
		message = '';
		saving = true;
		try {
			const result = await scanner.scan(
				pixels,
				quad,
				retake === undefined ? { filter } : { filter, retake }
			);
			if (!result.ok) {
				message = result.error;
				return;
			}
			onDone?.({ id: result.id, paper: result.paper });
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	const filters: Filter[] = ['original', 'greyscale', 'bw'];
	const percent = (value: number, of: number) => `${(value / of) * 100}%`;
	const button =
		'min-h-11 rounded-xl bg-(--xcwds-shell-card) px-4 font-medium hover:not-disabled:bg-(--xcwds-shell-hover-bg) active:bg-(--xcwds-shell-hover-bg) disabled:opacity-40';
</script>

<div class="flex flex-col gap-3" data-testid="crop">
	{#if !scanner}
		<p>{t.missing}</p>
	{:else if pixels === undefined}
		<p aria-live="polite">{t.loading}</p>
	{:else if pixels === null}
		<p class="text-sm text-red-700 dark:text-red-400" role="alert">{message || READ_ERROR}</p>
	{:else}
		<p id="{uid}-found" aria-live="polite" data-found={start?.found}>
			{!start ? t.finding : start.found ? t.found : t.notFound}
		</p>
		<!-- Room around the photo so a handle on its edge stays whole and inside the page. -->
		<div class="px-5 py-5">
			<div class="relative" bind:this={frame}>
				<canvas bind:this={canvas} class="block h-auto w-full rounded-lg bg-black"></canvas>
				{#if quad && size}
					<svg
						class="pointer-events-none absolute inset-0 size-full overflow-visible"
						viewBox="0 0 {size.width} {size.height}"
						preserveAspectRatio="none"
						aria-hidden="true"
					>
						<polygon
							points={quad.map((p) => `${p.x},${p.y}`).join(' ')}
							fill="color-mix(in srgb, var(--xcwds-shell-accent) 15%, transparent)"
							stroke={problem ? '#dc2626' : 'var(--xcwds-shell-accent)'}
							stroke-width="2"
							vector-effect="non-scaling-stroke"
						/>
					</svg>
					{#each quad as corner, index (index)}
						<button
							type="button"
							class="absolute size-11 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-4 border-(--xcwds-shell-accent) bg-white/70 active:cursor-grabbing"
							style:left={percent(corner.x, size.width)}
							style:top={percent(corner.y, size.height)}
							aria-label="{CORNERS[index]} {t.corner}"
							aria-describedby="{uid}-hint"
							data-corner={index}
							data-x={Math.round(corner.x)}
							data-y={Math.round(corner.y)}
							disabled={saving}
							onpointerdown={(e) => pointerDown(e, index)}
							onpointermove={pointerMove}
							onpointerup={pointerUp}
							onpointercancel={pointerUp}
							onlostpointercapture={pointerUp}
							onkeydown={(e) => keyDown(e, index)}
						></button>
					{/each}
				{/if}
			</div>
		</div>
		<p id="{uid}-hint" class="text-sm text-(--xcwds-shell-muted)">{t.hint}</p>
		<p class="sr-only" aria-live="polite" data-testid="crop-moved">{moved}</p>
		<p id="{uid}-status" class="text-sm text-red-700 dark:text-red-400" aria-live="polite">
			{problem || message}
		</p>

		<fieldset class="flex flex-wrap items-center gap-x-4 gap-y-1">
			<legend class="font-medium">{t.filter}</legend>
			{#each filters as option (option)}
				<label class="flex min-h-11 items-center gap-2">
					<input
						type="radio"
						class="size-5"
						name="{uid}-filter"
						value={option}
						bind:group={filter}
						disabled={saving}
					/>
					{t[option]}
				</label>
			{/each}
		</fieldset>

		<div class="flex flex-wrap items-center gap-3">
			<button
				type="button"
				class="min-h-11 rounded-xl bg-(--xcwds-shell-accent) px-4 font-medium text-white hover:not-disabled:opacity-90 active:opacity-90 disabled:opacity-40"
				onclick={add}
				disabled={saving || !!problem || !quad}
				aria-describedby="{uid}-status"
			>
				{saving ? t.saving : retake === undefined ? t.add : t.replace}
			</button>
			<button type="button" class={button} onclick={reset} disabled={saving || !start}>
				{t.reset}
			</button>
			{#if onCancel}
				<button type="button" class={button} onclick={onCancel} disabled={saving}>
					{t.cancel}
				</button>
			{/if}
		</div>
	{/if}
</div>
