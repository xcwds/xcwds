/**
 * A QR code encoder (ISO/IEC 18004, model 2): text in byte mode as UTF-8, versions 1 to 40, the
 * four error correction levels, and the mask with the lowest penalty. Plain arithmetic, no DOM, so
 * it runs in the build, the page or a Worker.
 */

/** How much of the code can be damaged and still read: about 7, 15, 25 or 30 percent. */
export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export interface QrMatrix {
	/** Modules on a side: 21 for version 1, up to 177 for version 40. */
	size: number;
	version: number;
	errorCorrection: ErrorCorrection;
	/** `size × size` modules, row by row: `true` is dark. */
	modules: boolean[];
}

export interface EncodeOptions {
	/** Default `'M'`. */
	errorCorrection?: ErrorCorrection;
	/**
	 * Raise the error correction while that fits in the same version (a free gain). Default
	 * `true`.
	 */
	boost?: boolean;
}

const LEVELS: ErrorCorrection[] = ['L', 'M', 'Q', 'H'];
/** The two format bits for each level, in `LEVELS` order. */
const FORMAT_BITS = [1, 0, 3, 2];

// Per level (L, M, Q, H) and version (index 1 to 40): error correction codewords per block, and
// the number of blocks.
const ECC_PER_BLOCK = [
	[
		-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
		30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30
	],
	[
		-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
		28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28
	],
	[
		-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30,
		30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30
	],
	[
		-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30,
		30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30
	]
];
const BLOCKS = [
	[
		-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
		15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25
	],
	[
		-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23,
		25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49
	],
	[
		-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34,
		34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68
	],
	[
		-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35,
		37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81
	]
];

/** Data and error correction modules in a version: everything but the function patterns. */
function rawModules(version: number): number {
	let n = (16 * version + 128) * version + 64;
	if (version >= 2) {
		const align = Math.floor(version / 7) + 2;
		n -= (25 * align - 10) * align - 55;
		if (version >= 7) n -= 36;
	}
	return n;
}

const dataCodewords = (version: number, level: number) =>
	Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[level]![version]! * BLOCKS[level]![version]!;

/** Bits in byte mode for `bytes` at `version`: mode, length and data. */
const dataBits = (bytes: number, version: number) => 4 + (version < 10 ? 8 : 16) + 8 * bytes;

// Reed-Solomon over GF(2^8) with the polynomial 0x11d.
function multiply(x: number, y: number): number {
	let z = 0;
	for (let i = 7; i >= 0; i--) {
		z = (z << 1) ^ ((z >>> 7) * 0x11d);
		z ^= ((y >>> i) & 1) * x;
	}
	return z;
}

function divisor(degree: number): number[] {
	const result = new Array<number>(degree).fill(0);
	result[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < degree; j++) {
			result[j] = multiply(result[j]!, root);
			if (j + 1 < degree) result[j] = result[j]! ^ result[j + 1]!;
		}
		root = multiply(root, 0x02);
	}
	return result;
}

function remainder(data: readonly number[], div: readonly number[]): number[] {
	const result = new Array<number>(div.length).fill(0);
	for (const b of data) {
		const factor = b ^ result.shift()!;
		result.push(0);
		div.forEach((coef, i) => (result[i] = result[i]! ^ multiply(coef, factor)));
	}
	return result;
}

/** Splits the data into blocks, adds each block's error correction, and interleaves them. */
function withErrorCorrection(data: number[], version: number, level: number): number[] {
	const blocks = BLOCKS[level]![version]!;
	const eccLength = ECC_PER_BLOCK[level]![version]!;
	const raw = Math.floor(rawModules(version) / 8);
	const short = blocks - (raw % blocks);
	const shortLength = Math.floor(raw / blocks);
	const div = divisor(eccLength);
	const all: number[][] = [];
	for (let i = 0, k = 0; i < blocks; i++) {
		const dat = data.slice(k, k + shortLength - eccLength + (i < short ? 0 : 1));
		k += dat.length;
		const ecc = remainder(dat, div);
		// Short blocks get a placeholder so every block lines up for interleaving.
		if (i < short) dat.push(-1);
		all.push(dat.concat(ecc));
	}
	const out: number[] = [];
	for (let i = 0; i < all[0]!.length; i++)
		all.forEach((block, j) => {
			if (i !== shortLength - eccLength || j >= short) out.push(block[i]!);
		});
	return out;
}

class Grid {
	readonly modules: boolean[];
	readonly fixed: boolean[];
	constructor(readonly size: number) {
		this.modules = new Array<boolean>(size * size).fill(false);
		this.fixed = new Array<boolean>(size * size).fill(false);
	}
	get(x: number, y: number) {
		return this.modules[y * this.size + x]!;
	}
	set(x: number, y: number, dark: boolean) {
		this.modules[y * this.size + x] = dark;
		this.fixed[y * this.size + x] = true;
	}
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function alignmentPositions(version: number): number[] {
	if (version === 1) return [];
	const count = Math.floor(version / 7) + 2;
	const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
	const result = [6];
	for (let pos = version * 4 + 10; result.length < count; pos -= step) result.splice(1, 0, pos);
	return result;
}

function drawFinder(grid: Grid, x: number, y: number) {
	for (let dy = -4; dy <= 4; dy++)
		for (let dx = -4; dx <= 4; dx++) {
			const dist = Math.max(Math.abs(dx), Math.abs(dy));
			const xx = x + dx;
			const yy = y + dy;
			if (xx >= 0 && xx < grid.size && yy >= 0 && yy < grid.size)
				grid.set(xx, yy, dist !== 2 && dist !== 4);
		}
}

function drawFormat(grid: Grid, level: number, mask: number) {
	const data = (FORMAT_BITS[level]! << 3) | mask;
	let rem = data;
	for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
	const bits = ((data << 10) | rem) ^ 0x5412;
	const size = grid.size;
	for (let i = 0; i <= 5; i++) grid.set(8, i, bit(bits, i));
	grid.set(8, 7, bit(bits, 6));
	grid.set(8, 8, bit(bits, 7));
	grid.set(7, 8, bit(bits, 8));
	for (let i = 9; i < 15; i++) grid.set(14 - i, 8, bit(bits, i));
	for (let i = 0; i < 8; i++) grid.set(size - 1 - i, 8, bit(bits, i));
	for (let i = 8; i < 15; i++) grid.set(8, size - 15 + i, bit(bits, i));
	grid.set(8, size - 8, true);
}

function drawVersion(grid: Grid, version: number) {
	if (version < 7) return;
	let rem = version;
	for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
	const bits = (version << 12) | rem;
	for (let i = 0; i < 18; i++) {
		const dark = bit(bits, i);
		const a = grid.size - 11 + (i % 3);
		const b = Math.floor(i / 3);
		grid.set(a, b, dark);
		grid.set(b, a, dark);
	}
}

function drawFunctionPatterns(grid: Grid, version: number, level: number) {
	const size = grid.size;
	for (let i = 0; i < size; i++) {
		grid.set(6, i, i % 2 === 0);
		grid.set(i, 6, i % 2 === 0);
	}
	drawFinder(grid, 3, 3);
	drawFinder(grid, size - 4, 3);
	drawFinder(grid, 3, size - 4);
	const align = alignmentPositions(version);
	const n = align.length;
	for (let i = 0; i < n; i++)
		for (let j = 0; j < n; j++) {
			if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
			for (let dy = -2; dy <= 2; dy++)
				for (let dx = -2; dx <= 2; dx++)
					grid.set(align[i]! + dx, align[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
		}
	// Reserve the format areas (drawn for real once the mask is chosen) and draw the version.
	drawFormat(grid, level, 0);
	drawVersion(grid, version);
}

function drawCodewords(grid: Grid, codewords: readonly number[]) {
	const size = grid.size;
	let i = 0;
	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		for (let vert = 0; vert < size; vert++)
			for (let j = 0; j < 2; j++) {
				const x = right - j;
				const upward = ((right + 1) & 2) === 0;
				const y = upward ? size - 1 - vert : vert;
				if (!grid.fixed[y * size + x] && i < codewords.length * 8) {
					grid.modules[y * size + x] = bit(codewords[i >>> 3]!, 7 - (i & 7));
					i++;
				}
			}
	}
}

const MASKS: ((x: number, y: number) => boolean)[] = [
	(x, y) => (x + y) % 2 === 0,
	(_x, y) => y % 2 === 0,
	(x) => x % 3 === 0,
	(x, y) => (x + y) % 3 === 0,
	(x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
	(x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
	(x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
	(x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

function applyMask(grid: Grid, mask: number) {
	const size = grid.size;
	const test = MASKS[mask]!;
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++)
			if (!grid.fixed[y * size + x] && test(x, y))
				grid.modules[y * size + x] = !grid.modules[y * size + x];
}

/** The standard's penalty score: lower reads more reliably. */
function penalty(grid: Grid): number {
	const size = grid.size;
	let score = 0;
	const line = (get: (i: number, j: number) => boolean) => {
		for (let i = 0; i < size; i++) {
			// Runs of five or more alike, and finder-like 1:1:3:1:1 patterns with four light beside.
			let run = 0;
			let color = false;
			const row: boolean[] = [];
			for (let j = 0; j < size; j++) {
				const dark = get(i, j);
				row.push(dark);
				if (j > 0 && dark === color) {
					run++;
					if (run === 5) score += 3;
					else if (run > 5) score++;
				} else {
					color = dark;
					run = 1;
				}
			}
			// The row as bits in a sliding 11-bit window, with four light modules past each end.
			let window = 0;
			for (let j = -4; j < size + 4; j++) {
				window = ((window << 1) | (j >= 0 && j < size && row[j] ? 1 : 0)) & 0x7ff;
				if (j >= 6 && (window === 0b10111010000 || window === 0b00001011101)) score += 40;
			}
		}
	};
	line((i, j) => grid.get(j, i));
	line((i, j) => grid.get(i, j));
	for (let y = 0; y < size - 1; y++)
		for (let x = 0; x < size - 1; x++) {
			const c = grid.get(x, y);
			if (c === grid.get(x + 1, y) && c === grid.get(x, y + 1) && c === grid.get(x + 1, y + 1))
				score += 3;
		}
	const dark = grid.modules.filter(Boolean).length;
	const total = size * size;
	score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
	return score;
}

/** Thrown when the text doesn't fit in a version 40 code at the asked level. */
export class QrTooLongError extends RangeError {
	constructor(bytes: number, level: ErrorCorrection) {
		super(
			`The text is too long for a QR code (${bytes} bytes; error correction ${level} holds less).`
		);
		this.name = 'QrTooLongError';
	}
}

/** Encodes `text` (as UTF-8) in the smallest QR code that holds it. */
export function encodeQr(text: string, options: EncodeOptions = {}): QrMatrix {
	const asked = options.errorCorrection ?? 'M';
	let level = LEVELS.indexOf(asked);
	if (level < 0) throw new TypeError(`Unknown error correction level "${String(asked)}".`);
	const bytes = [...new TextEncoder().encode(text)];

	let version = 1;
	for (; version <= 40; version++)
		if (dataBits(bytes.length, version) <= dataCodewords(version, level) * 8) break;
	if (version > 40) throw new QrTooLongError(bytes.length, asked);
	if (options.boost ?? true)
		while (level < 3 && dataBits(bytes.length, version) <= dataCodewords(version, level + 1) * 8)
			level++;

	// Mode (byte), length, data, then the terminator and padding.
	const bits: number[] = [];
	const append = (value: number, length: number) => {
		for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
	};
	append(0b0100, 4);
	append(bytes.length, version < 10 ? 8 : 16);
	for (const b of bytes) append(b, 8);
	const capacity = dataCodewords(version, level) * 8;
	append(0, Math.min(4, capacity - bits.length));
	append(0, (8 - (bits.length % 8)) % 8);
	for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);
	const data: number[] = [];
	for (let i = 0; i < bits.length; i += 8)
		data.push(bits.slice(i, i + 8).reduce((byte, b) => (byte << 1) | b, 0));

	const size = version * 4 + 17;
	const grid = new Grid(size);
	drawFunctionPatterns(grid, version, level);
	drawCodewords(grid, withErrorCorrection(data, version, level));

	let best = 0;
	let lowest = Infinity;
	for (let mask = 0; mask < 8; mask++) {
		applyMask(grid, mask);
		drawFormat(grid, level, mask);
		const score = penalty(grid);
		if (score < lowest) {
			lowest = score;
			best = mask;
		}
		applyMask(grid, mask);
	}
	applyMask(grid, best);
	drawFormat(grid, level, best);
	return { size, version, errorCorrection: LEVELS[level]!, modules: grid.modules };
}
