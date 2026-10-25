/**
 * `@xcwds/plugin-scanner/geometry`: the maths that straightens a photographed page. A page's four
 * corners map to a rectangle through a homography (a 3 × 3 projective transform), and the
 * rectangle's size comes from the page's edges. Pure functions, safe to import anywhere.
 */

export interface Point {
	x: number;
	y: number;
}

/** A page's corners, clockwise from the top left: top left, top right, bottom right, bottom left. */
export type Quad = readonly [Point, Point, Point, Point];

/** A 3 × 3 matrix in row order, normalised so the last entry is 1. */
export type Matrix = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number
];

/** Paper sizes a scan snaps to, as long side over short side. */
export const PAPER = { a4: Math.SQRT2, letter: 11 / 8.5 } as const;

export type Paper = keyof typeof PAPER;

/**
 * The homography that maps each corner of `from` onto the same corner of `to`, or `null` when
 * there's none (three corners of either quad on one line, or two in the same place).
 */
export function homography(from: Quad, to: Quad): Matrix | null {
	if (degenerate(from) || degenerate(to)) return null;
	// Both through the unit square, in closed form (Heckbert, "Fundamentals of Texture Mapping"),
	// which stays accurate at pixel scale where a general 8 × 8 solve loses precision.
	const m = multiply(fromSquare(to), adjugate(fromSquare(from)));
	const last = m[8]!;
	return last === 0 ? null : (m.map((v) => v / last) as unknown as Matrix);
}

/** Where `point` lands under `m`. */
export function project(m: Matrix, point: Point): Point {
	const { x, y } = point;
	const w = m[6] * x + m[7] * y + m[8];
	return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

/**
 * Whether `quad` is a page a scan can straighten: its corners in clockwise order on screen (y
 * down), every turn the same way, with some area.
 */
export function isConvex(quad: Quad): boolean {
	for (let i = 0; i < 4; i++) {
		const a = quad[i]!;
		const b = quad[(i + 1) % 4]!;
		const c = quad[(i + 2) % 4]!;
		const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
		if (!(cross > 0)) return false;
	}
	return true;
}

export interface PageSize {
	width: number;
	height: number;
	/** The paper size it was snapped to, if any. */
	paper: Paper | null;
}

/**
 * The size of the straightened page in pixels: as wide as the quad's longer horizontal edge and as
 * tall as its longer vertical edge, so no detail is lost. When the shape is within `tolerance`
 * (a fraction, 3% by default) of A4 or Letter, the short side is adjusted to match it exactly,
 * because a page photographed at an angle rarely measures true.
 */
export function pageSize(quad: Quad, { tolerance = 0.03 }: { tolerance?: number } = {}): PageSize {
	const [tl, tr, br, bl] = quad;
	let width = Math.max(1, Math.round(Math.max(distance(tl, tr), distance(bl, br))));
	let height = Math.max(1, Math.round(Math.max(distance(tl, bl), distance(tr, br))));
	const long = Math.max(width, height);
	const short = Math.min(width, height);
	const ratio = long / short;
	let paper: Paper | null = null;
	let closest = tolerance;
	for (const [name, target] of Object.entries(PAPER) as [Paper, number][]) {
		const off = Math.abs(ratio - target) / target;
		if (off <= closest) {
			closest = off;
			paper = name;
		}
	}
	if (paper) {
		const snapped = Math.max(1, Math.round(long / PAPER[paper]));
		if (width >= height) height = snapped;
		else width = snapped;
	}
	return { width, height, paper };
}

/** The four corners of a `width` × `height` rectangle at the origin, as a `Quad`. */
export function rectangle(width: number, height: number): Quad {
	return [
		{ x: 0, y: 0 },
		{ x: width, y: 0 },
		{ x: width, y: height },
		{ x: 0, y: height }
	];
}

function distance(a: Point, b: Point): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Whether three of the corners lie on one line (two in the same place included). */
function degenerate(quad: Quad): boolean {
	const size = Math.max(
		...quad.map((p, i) => distance(p, quad[(i + 1) % 4]!)),
		distance(quad[0], quad[2]),
		distance(quad[1], quad[3])
	);
	if (!(size > 0) || !quad.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return true;
	for (let skip = 0; skip < 4; skip++) {
		const [a, b, c] = quad.filter((_, i) => i !== skip) as [Point, Point, Point];
		const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
		if (Math.abs(cross) < 1e-9 * size * size) return true;
	}
	return false;
}

/** The homography from the unit square's corners (same order as a `Quad`) onto `quad`. */
function fromSquare(quad: Quad): number[] {
	const [p0, p1, p2, p3] = quad;
	const dx1 = p1.x - p2.x;
	const dx2 = p3.x - p2.x;
	const dx3 = p0.x - p1.x + p2.x - p3.x;
	const dy1 = p1.y - p2.y;
	const dy2 = p3.y - p2.y;
	const dy3 = p0.y - p1.y + p2.y - p3.y;
	const det = dx1 * dy2 - dx2 * dy1;
	const g = (dx3 * dy2 - dx2 * dy3) / det;
	const h = (dx1 * dy3 - dx3 * dy1) / det;
	return [
		p1.x - p0.x + g * p1.x,
		p3.x - p0.x + h * p3.x,
		p0.x,
		p1.y - p0.y + g * p1.y,
		p3.y - p0.y + h * p3.y,
		p0.y,
		g,
		h,
		1
	];
}

/** The inverse of `m` up to scale, which is all a homography needs. */
function adjugate(m: readonly number[]): number[] {
	const [a, b, c, d, e, f, g, h, i] = m as [
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number
	];
	return [
		e * i - f * h,
		c * h - b * i,
		b * f - c * e,
		f * g - d * i,
		a * i - c * g,
		c * d - a * f,
		d * h - e * g,
		b * g - a * h,
		a * e - b * d
	];
}

function multiply(x: readonly number[], y: readonly number[]): number[] {
	const out: number[] = [];
	for (let r = 0; r < 3; r++)
		for (let c = 0; c < 3; c++)
			out.push(x[r * 3]! * y[c]! + x[r * 3 + 1]! * y[3 + c]! + x[r * 3 + 2]! * y[6 + c]!);
	return out;
}
