<script lang="ts">
	/**
	 * A QR code for `value` (`@xcwds/plugin-qr`), drawn as SVG on the device: crisp at any size,
	 * black on white whatever the theme (scanners need the contrast), with the text as its label.
	 *
	 * ```svelte
	 * <QrCode value="https://example.com" class="w-64" />
	 * ```
	 *
	 * Text too long for a QR code shows `tooLong` instead; empty text shows nothing (a code for it
	 * would scan to nothing).
	 */
	import { checkMargin, encodeQr, qrPath, type ErrorCorrection } from './make.js';

	let {
		value,
		errorCorrection = 'M',
		margin = 4,
		label,
		tooLong = 'This is too long for a QR code.',
		class: className = ''
	}: {
		value: string;
		/** `L`, `M` (default), `Q` or `H`: more survives damage, but the code gets denser. */
		errorCorrection?: ErrorCorrection;
		/** Light modules around the code; scanners need some. Default 4. */
		margin?: number;
		/** What a screen reader says. Default: `QR code: <value>`. */
		label?: string;
		tooLong?: string;
		class?: string;
	} = $props();

	const code = $derived.by(() => {
		const quiet = checkMargin(margin);
		if (value === '') return null;
		try {
			const matrix = encodeQr(value, { errorCorrection });
			return { side: matrix.size + quiet * 2, d: qrPath(matrix, quiet) };
		} catch (e) {
			if (e instanceof RangeError) return undefined;
			throw e;
		}
	});
</script>

{#if code}
	<svg
		class={className}
		data-qr
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 {code.side} {code.side}"
		role="img"
		aria-label={label ?? `QR code: ${value}`}
		shape-rendering="crispEdges"
	>
		<rect width={code.side} height={code.side} fill="#fff" />
		<path fill="#000" d={code.d} />
	</svg>
{:else if code === undefined}
	<p class={className} data-qr-error role="alert">{tooLong}</p>
{/if}
