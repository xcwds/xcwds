/**
 * `@xcwds/plugin-scanner/corners`: find a page's corners in a photo, as a starting point for the
 * crop screen. The photo is shrunk to a small greyscale frame, split into page and background by
 * brightness (Otsu's threshold), and the largest bright region is fitted with the four-cornered
 * shape that covers most of it; each side is then refined with a line through the region's edge.
 * When the result doesn't look like a page, it says so, and the crop starts from the whole photo.
 * Pure functions on RGBA pixels, safe to import anywhere (the plugin runs them in a Worker).
 */
import { isConvex, rectangle, type Point, type Quad } from './geometry.js';
import type { Pixels } from './warp.js';

export interface FindPageOptions {
	/** The longer side of the frame the search runs on, in pixels: 256 by default. */
	size?: number;
}

export interface StartCorners {
	/** The page's corners in the photo's pixels, or the whole photo when no page was found. */
	quad: Quad;
	/** Whether `quad` is a page that was found. */
	found: boolean;
}

/** A page must cover at least this share of the photo to be found. */
const MIN_AREA = 0.08;
/** A region covering more than this share is the whole photo, not a page on something. */
const MAX_AREA = 0.95;
/** How much of the region the four corners must cover, to say it has four corners. */
const MIN_FIT = 0.9;
/** How much of the region's outline it must fill (holes such as text included). */
const MIN_SOLIDITY = 0.85;
/** How far apart page and background must be, in grey levels and in their own spread. */
const MIN_CONTRAST = 24;
const MIN_SEPARATION = 2.5;
/** The flattest and sharpest a corner may be, in degrees, for a page photographed at an angle. */
const MIN_ANGLE = 35;
const MAX_ANGLE = 145;

/**
 * The corners of the page in `pixels` (clockwise from the top left, in its pixels), or `null`
 * when there's no page that stands out clearly from what it's on. Throws a `RangeError` for
 * pixels that don't match their width and height.
 */
export function findPage(pixels: Pixels, options: FindPageOptions = {}): Quad | null {
	const { width, height, data } = pixels;
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width < 1 ||
		height < 1 ||
		data.length !== width * height * 4
	)
		throw new RangeError('The pixels don’t match their width and height.');
	const size = options.size ?? 256;
	if (!(Number.isInteger(size) && size >= 16))
		throw new RangeError('The size must be a whole number of pixels from 16.');
	const frame = shrink(pixels, size);
	const split = otsu(frame.luma);
	if (!split) return null;
	const quad = fitPage(frame, split.threshold);
	if (!quad) return null;
	// Back to the photo's pixels, kept inside it.
	return quad.map((p) => ({
		x: Math.min(Math.max(p.x * frame.step, 0), width),
		y: Math.min(Math.max(p.y * frame.step, 0), height)
	})) as unknown as Quad;
}

/** Where the crop screen starts: the page `findPage` finds, or else the whole photo. */
export function startCorners(pixels: Pixels, options?: FindPageOptions): StartCorners {
	const quad = findPage(pixels, options);
	return quad
		? { quad, found: true }
		: { quad: rectangle(pixels.width, pixels.height), found: false };
}

interface Frame {
	width: number;
	height: number;
	/** How many of the photo's pixels each of the frame's spans, across and down. */
	step: number;
	luma: Float32Array;
}

/**
 * The photo's brightness, averaged over square blocks so its longer side is at most `size`, which
 * also evens out the camera's noise. Blocks at the right and bottom edges may be cut short.
 */
function shrink(pixels: Pixels, size: number): Frame {
	const { width, height, data } = pixels;
	const step = Math.max(1, Math.ceil(Math.max(width, height) / size));
	const w = Math.ceil(width / step);
	const h = Math.ceil(height / step);
	const sums = new Float64Array(w * h);
	const counts = new Uint32Array(w * h);
	for (let y = 0; y < height; y++) {
		const row = Math.floor(y / step) * w;
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const j = row + Math.floor(x / step);
			sums[j]! += (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
			counts[j]!++;
		}
	}
	const luma = new Float32Array(w * h);
	for (let j = 0; j < luma.length; j++) luma[j] = sums[j]! / counts[j]!;
	return { width: w, height: h, step, luma };
}

/**
 * Otsu's threshold between the dark and bright levels of `luma`, or `null` when the two aren't
 * far enough apart to be a page and what it's on.
 */
function otsu(luma: Float32Array): { threshold: number } | null {
	const histogram = new Float64Array(256);
	for (const v of luma) histogram[Math.min(255, Math.max(0, Math.round(v)))]!++;
	const total = luma.length;
	let sumAll = 0;
	for (let v = 0; v < 256; v++) sumAll += v * histogram[v]!;
	let best = -1;
	let threshold = 0;
	let below = 0;
	let sumBelow = 0;
	for (let t = 0; t < 255; t++) {
		below += histogram[t]!;
		sumBelow += t * histogram[t]!;
		const above = total - below;
		if (below === 0 || above === 0) continue;
		const meanBelow = sumBelow / below;
		const meanAbove = (sumAll - sumBelow) / above;
		const between = below * above * (meanAbove - meanBelow) ** 2;
		if (between > best) {
			best = between;
			threshold = t;
		}
	}
	if (best < 0) return null;
	// How far apart the two sides are, against how much each varies.
	let n0 = 0;
	let s0 = 0;
	let q0 = 0;
	let n1 = 0;
	let s1 = 0;
	let q1 = 0;
	for (let v = 0; v < 256; v++) {
		const c = histogram[v]!;
		if (v <= threshold) {
			n0 += c;
			s0 += c * v;
			q0 += c * v * v;
		} else {
			n1 += c;
			s1 += c * v;
			q1 += c * v * v;
		}
	}
	const m0 = s0 / n0;
	const m1 = s1 / n1;
	// Rounding can leave a flat side's variance a hair below 0, which would make the spread NaN.
	const spread = Math.sqrt((Math.max(0, q0 / n0 - m0 * m0) + Math.max(0, q1 / n1 - m1 * m1)) / 2);
	if (m1 - m0 < MIN_CONTRAST || m1 - m0 < MIN_SEPARATION * spread) return null;
	return { threshold: threshold + 0.5 };
}

/** The page in `frame`'s pixels, as its largest region brighter than `threshold`, if it's a page. */
function fitPage(frame: Frame, threshold: number): Quad | undefined {
	const { width, height, luma } = frame;
	const mask = new Uint8Array(width * height);
	for (let i = 0; i < mask.length; i++) mask[i] = luma[i]! > threshold ? 1 : 0;
	const region = largestRegion(mask, width, height);
	if (!region) return;
	const { solid, filled } = fill(region, width, height);
	const area = width * height;
	if (filled < MIN_AREA * area || filled > MAX_AREA * area) return;

	// The region's outline: the centres of its pixels that touch what's around it (not its holes,
	// so a page's text never pulls a side in).
	const edge: Point[] = [];
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			if (!solid[i]) continue;
			if (
				x === 0 ||
				y === 0 ||
				x === width - 1 ||
				y === height - 1 ||
				!solid[i - 1] ||
				!solid[i + 1] ||
				!solid[i - width] ||
				!solid[i + width]
			)
				edge.push({ x: x + 0.5, y: y + 0.5 });
		}
	const hull = convexHull(edge);
	if (hull.length < 4) return;
	const hullArea = polygonArea(hull);
	if (!(hullArea > 0) || filled < MIN_SOLIDITY * hullArea) return;
	const coarse = largestQuad(hull);
	if (!coarse || polygonArea(coarse) < MIN_FIT * hullArea) return;
	// A wide look first, since a dog-eared corner leaves the hull's corner well off the page's
	// sides, then a close one along the sides that look found.
	const quad = order(refine(refine(coarse, coarse, edge, 0.08), coarse, edge, 0.03));
	if (!isConvex(quad) || !anglesOk(quad)) return;
	return quad;
}

interface Region {
	labels: Uint8Array;
	count: number;
}

/** The largest 4-connected region of `mask`'s set pixels. */
function largestRegion(mask: Uint8Array, width: number, height: number): Region | undefined {
	const seen = new Uint8Array(mask.length);
	const stack = new Int32Array(mask.length);
	let bestStart = -1;
	let bestCount = 0;
	for (let start = 0; start < mask.length; start++) {
		if (!mask[start] || seen[start]) continue;
		const count = flood(mask, seen, stack, start, width, height);
		if (count > bestCount) {
			bestCount = count;
			bestStart = start;
		}
	}
	if (bestStart < 0) return;
	const labels = new Uint8Array(mask.length);
	flood(mask, labels, stack, bestStart, width, height);
	return { labels, count: bestCount };
}

/** Marks in `seen` the 4-connected pixels of `mask` reached from `start`, and counts them. */
function flood(
	mask: Uint8Array,
	seen: Uint8Array,
	stack: Int32Array,
	start: number,
	width: number,
	height: number
): number {
	let top = 0;
	let count = 0;
	stack[top++] = start;
	seen[start] = 1;
	while (top > 0) {
		const i = stack[--top]!;
		count++;
		const x = i % width;
		const y = (i - x) / width;
		if (x > 0) push(i - 1);
		if (x < width - 1) push(i + 1);
		if (y > 0) push(i - width);
		if (y < height - 1) push(i + width);
	}
	return count;

	function push(j: number) {
		if (mask[j] && !seen[j]) {
			seen[j] = 1;
			stack[top++] = j;
		}
	}
}

/**
 * `region` with its holes (such as a page's text) filled in: everything the frame's border can't
 * reach without crossing it. `filled` counts its pixels.
 */
function fill(
	region: Region,
	width: number,
	height: number
): { solid: Uint8Array; filled: number } {
	const { labels } = region;
	const outside = new Uint8Array(labels.length);
	for (let i = 0; i < labels.length; i++) outside[i] = labels[i] ? 0 : 1;
	const reached = new Uint8Array(labels.length);
	const stack = new Int32Array(labels.length);
	const from = (i: number) => {
		if (outside[i] && !reached[i]) flood(outside, reached, stack, i, width, height);
	};
	for (let x = 0; x < width; x++) {
		from(x);
		from((height - 1) * width + x);
	}
	for (let y = 0; y < height; y++) {
		from(y * width);
		from(y * width + width - 1);
	}
	const solid = new Uint8Array(labels.length);
	let filled = 0;
	for (let i = 0; i < labels.length; i++)
		if (!reached[i]) {
			solid[i] = 1;
			filled++;
		}
	return { solid, filled };
}

/** The convex hull of `points`, clockwise on screen (y down), without points along its sides. */
function convexHull(points: Point[]): Point[] {
	const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
	if (sorted.length < 3) return sorted;
	const cross = (o: Point, a: Point, b: Point) =>
		(a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const lower: Point[] = [];
	for (const p of sorted) {
		while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
		lower.push(p);
	}
	const upper: Point[] = [];
	for (let i = sorted.length - 1; i >= 0; i--) {
		const p = sorted[i]!;
		while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
		upper.push(p);
	}
	return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The area of a simple polygon, whichever way round it goes. */
function polygonArea(polygon: readonly Point[]): number {
	let sum = 0;
	for (let i = 0; i < polygon.length; i++) {
		const a = polygon[i]!;
		const b = polygon[(i + 1) % polygon.length]!;
		sum += a.x * b.y - b.x * a.y;
	}
	return Math.abs(sum) / 2;
}

/**
 * The largest-area quadrilateral with its corners on `hull`'s vertices. For each diagonal, the
 * best corner on either side is the one furthest from it.
 */
function largestQuad(hull: Point[]): Point[] | undefined {
	const n = hull.length;
	let best = 0;
	let quad: Point[] | undefined;
	for (let i = 0; i < n; i++) {
		for (let k = i + 2; k < n; k++) {
			if (i === 0 && k === n - 1) continue;
			const a = hull[i]!;
			const c = hull[k]!;
			let left = 0;
			let j = -1;
			for (let m = i + 1; m < k; m++) {
				const t = triangle(a, hull[m]!, c);
				if (t > left) {
					left = t;
					j = m;
				}
			}
			let right = 0;
			let l = -1;
			for (let m = k + 1; m < n + i; m++) {
				const t = triangle(c, hull[m % n]!, a);
				if (t > right) {
					right = t;
					l = m % n;
				}
			}
			if (j < 0 || l < 0) continue;
			if (left + right > best) {
				best = left + right;
				quad = [a, hull[j]!, c, hull[l]!];
			}
		}
	}
	return quad;
}

function triangle(a: Point, b: Point, c: Point): number {
	return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
}

/**
 * The corners where lines fitted through each side's outline meet, looking for the outline within
 * `band` (a fraction of the side's length) of each side of `quad`. The outline near a corner is
 * left out, since a dog-eared or rounded corner bends away from the page's sides. A corner whose
 * lines meet far from `coarse`'s (nearly parallel sides) keeps `quad`'s.
 */
function refine(quad: Point[], coarse: Point[], edge: Point[], band: number): Point[] {
	const centre = {
		x: (quad[0]!.x + quad[1]!.x + quad[2]!.x + quad[3]!.x) / 4,
		y: (quad[0]!.y + quad[1]!.y + quad[2]!.y + quad[3]!.y) / 4
	};
	const lines: (Line | undefined)[] = [];
	for (let s = 0; s < 4; s++) {
		const a = quad[s]!;
		const b = quad[(s + 1) % 4]!;
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		const near = Math.max(1.5, band * length);
		const ux = (b.x - a.x) / length;
		const uy = (b.y - a.y) / length;
		const on: Point[] = [];
		for (const p of edge) {
			const along = (p.x - a.x) * ux + (p.y - a.y) * uy;
			const off = Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux);
			if (off <= near && along > 0.15 * length && along < 0.85 * length) on.push(p);
		}
		const line = on.length >= 5 ? fitLine(on) : undefined;
		// The outline runs through the centres of the region's outer pixels, half a pixel inside its
		// edge, so the line moves out by that much.
		if (line) {
			const side = (centre.x - line.x) * line.nx + (centre.y - line.y) * line.ny;
			const out = side > 0 ? -0.5 : 0.5;
			line.x += line.nx * out;
			line.y += line.ny * out;
		}
		lines.push(line);
	}
	const diagonal = Math.hypot(coarse[2]!.x - coarse[0]!.x, coarse[2]!.y - coarse[0]!.y);
	return quad.map((corner, i) => {
		const before = lines[(i + 3) % 4];
		const after = lines[i];
		const meet = before && after ? intersect(before, after) : undefined;
		const from = coarse[i]!;
		return meet && Math.hypot(meet.x - from.x, meet.y - from.y) < 0.15 * diagonal ? meet : corner;
	});
}

/** A line through (`x`, `y`) with unit normal (`nx`, `ny`). */
interface Line {
	x: number;
	y: number;
	nx: number;
	ny: number;
}

/** The line closest to `points` (total least squares). */
function fitLine(points: Point[]): Line {
	let mx = 0;
	let my = 0;
	for (const p of points) {
		mx += p.x;
		my += p.y;
	}
	mx /= points.length;
	my /= points.length;
	let xx = 0;
	let xy = 0;
	let yy = 0;
	for (const p of points) {
		const dx = p.x - mx;
		const dy = p.y - my;
		xx += dx * dx;
		xy += dx * dy;
		yy += dy * dy;
	}
	// The direction the points spread along most; the normal is at right angles to it.
	const angle = Math.atan2(2 * xy, xx - yy) / 2;
	return { x: mx, y: my, nx: -Math.sin(angle), ny: Math.cos(angle) };
}

function intersect(a: Line, b: Line): Point | undefined {
	const det = a.nx * b.ny - a.ny * b.nx;
	if (Math.abs(det) < 1e-6) return;
	const ca = a.nx * a.x + a.ny * a.y;
	const cb = b.nx * b.x + b.ny * b.y;
	return { x: (ca * b.ny - cb * a.ny) / det, y: (a.nx * cb - b.nx * ca) / det };
}

/** `quad` as a `Quad`: clockwise on screen, starting from the corner nearest the top left. */
function order(quad: Point[]): Quad {
	let points = quad;
	const signed = points.reduce((sum, a, i) => {
		const b = points[(i + 1) % 4]!;
		return sum + (a.x * b.y - b.x * a.y);
	}, 0);
	if (signed < 0) points = [...points].reverse();
	let first = 0;
	for (let i = 1; i < 4; i++)
		if (points[i]!.x + points[i]!.y < points[first]!.x + points[first]!.y) first = i;
	return [0, 1, 2, 3].map((i) => points[(first + i) % 4]!) as unknown as Quad;
}

/** Whether every corner of `quad` is between `MIN_ANGLE` and `MAX_ANGLE`. */
function anglesOk(quad: Quad): boolean {
	for (let i = 0; i < 4; i++) {
		const prev = quad[(i + 3) % 4]!;
		const p = quad[i]!;
		const next = quad[(i + 1) % 4]!;
		const ax = prev.x - p.x;
		const ay = prev.y - p.y;
		const bx = next.x - p.x;
		const by = next.y - p.y;
		const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
		const angle = (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
		if (!(angle >= MIN_ANGLE && angle <= MAX_ANGLE)) return false;
	}
	return true;
}
