/**
 * Just enough semver to check a plugin's `core` range at boot, without a dependency in every
 * app's bundle. Supports exact versions, `*`, `x` wildcards (`1.x`, `1`), `^`, `~`, the
 * comparators `>`, `>=`, `<`, `<=`, `=`, hyphen ranges (`1.2.3 - 2.0.0`), space-separated AND
 * and `||`. Prerelease tags are lower than the release and compare identifier by identifier
 * (`beta.2` < `beta.10`), as in semver.
 */

type Version = [number, number, number, string];

function parse(version: string): Version | undefined {
	const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
		version.trim()
	);
	if (!m) return undefined;
	return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ''];
}

function compare(a: Version, b: Version): number {
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
	if (a[3] === b[3]) return 0;
	if (a[3] === '') return 1;
	if (b[3] === '') return -1;
	return comparePrerelease(a[3], b[3]);
}

const NUMERIC = /^\d+$/;

/**
 * Semver's prerelease precedence: dot-separated identifiers left to right, numerically when both
 * are numeric, numeric below alphanumeric, otherwise in ASCII order; a prefix sorts first.
 */
function comparePrerelease(a: string, b: string): number {
	const x = a.split('.');
	const y = b.split('.');
	for (let i = 0; i < Math.min(x.length, y.length); i++) {
		const [p, q] = [x[i]!, y[i]!];
		if (p === q) continue;
		const [pn, qn] = [NUMERIC.test(p), NUMERIC.test(q)];
		if (pn && qn) return Number(p) - Number(q);
		if (pn !== qn) return pn ? -1 : 1;
		return p < q ? -1 : 1;
	}
	return x.length - y.length;
}

type Comparator = { op: '<' | '<=' | '>' | '>=' | '='; version: Version };

/** A partial version (`1`, `1.2`, `1.x`) as [major, minor, patch] with undefined wildcards. */
function partial(text: string): (number | undefined)[] | undefined {
	const parts = text.replace(/^v/, '').split('-')[0]!.split('.');
	if (parts.length > 3) return undefined;
	const out: (number | undefined)[] = [];
	for (const p of parts) {
		if (p === 'x' || p === 'X' || p === '*') out.push(undefined);
		else if (/^\d+$/.test(p)) out.push(Number(p));
		else return undefined;
	}
	while (out.length < 3) out.push(undefined);
	return out;
}

const v = (major: number, minor = 0, patch = 0, pre = ''): Version => [major, minor, patch, pre];

function expand(token: string): Comparator[] | undefined {
	if (token === '*' || token === '' || token === 'x' || token === 'X') return [];
	const op = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(token)!;
	const operator = op[1] ?? '';
	const rest = op[2]!;
	const exact = parse(rest);
	const p = partial(rest);
	if (!exact && !p) return undefined;
	const [major, minor, patch] = p ?? [];
	const wild = !exact;
	if (operator === '' || operator === '=') {
		if (exact) return [{ op: '=', version: exact }];
		if (major === undefined) return [];
		if (minor === undefined)
			return [
				{ op: '>=', version: v(major) },
				{ op: '<', version: v(major + 1, 0, 0, '0') }
			];
		return [
			{ op: '>=', version: v(major, minor) },
			{ op: '<', version: v(major, minor + 1, 0, '0') }
		];
	}
	const base = exact ?? v(major ?? 0, minor ?? 0, patch ?? 0);
	if (operator === '^') {
		if (major === undefined) return [];
		let upper: Version;
		if (major > 0 || minor === undefined) upper = v(major + 1, 0, 0, '0');
		else if (minor > 0 || patch === undefined) upper = v(0, minor + 1, 0, '0');
		else upper = v(0, 0, (patch ?? 0) + 1, '0');
		return [
			{ op: '>=', version: base },
			{ op: '<', version: upper }
		];
	}
	if (operator === '~') {
		if (major === undefined) return [];
		const upper = minor === undefined ? v(major + 1, 0, 0, '0') : v(major, minor + 1, 0, '0');
		return [
			{ op: '>=', version: base },
			{ op: '<', version: upper }
		];
	}
	if (wild && (operator === '>' || operator === '<=') && major !== undefined) {
		// `>1.x` means `>=2.0.0`; `<=1.x` means `<2.0.0`.
		const next = minor === undefined ? v(major + 1) : v(major, minor + 1);
		return [{ op: operator === '>' ? '>=' : '<', version: next }];
	}
	return [{ op: operator as Comparator['op'], version: base }];
}

/** `low - high`: `>=low` (missing parts are 0) and `<=high`, or below the next `high` if partial. */
function hyphen(low: string, high: string): Comparator[] | undefined {
	const out: Comparator[] = [];
	const lo = parse(low);
	const lp = lo ? undefined : partial(low);
	if (lo) out.push({ op: '>=', version: lo });
	else if (!lp) return undefined;
	else if (lp[0] !== undefined) out.push({ op: '>=', version: v(lp[0], lp[1] ?? 0, lp[2] ?? 0) });
	const hi = parse(high);
	if (hi) return [...out, { op: '<=', version: hi }];
	const hp = partial(high);
	if (!hp) return undefined;
	const [major, minor] = hp;
	if (major === undefined) return out;
	const next = minor === undefined ? v(major + 1, 0, 0, '0') : v(major, minor + 1, 0, '0');
	return [...out, { op: '<', version: next }];
}

/** The comparators of one `||` alternative, or undefined if it isn't a range we understand. */
function comparators(set: string): Comparator[] | undefined {
	const range = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(set);
	if (range) return hyphen(range[1]!, range[2]!);
	const out: Comparator[] = [];
	const tokens = set
		.trim()
		.replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1')
		.split(/\s+/)
		.filter(Boolean);
	for (const token of tokens) {
		const expanded = expand(token);
		if (!expanded) return undefined;
		out.push(...expanded);
	}
	return out;
}

/** Whether `range` is a range `satisfies` understands (see the top of this file). */
export const validRange = (range: string): boolean =>
	range.split('||').every((set) => comparators(set) !== undefined);

function test(version: Version, c: Comparator): boolean {
	const d = compare(version, c.version);
	switch (c.op) {
		case '<':
			return d < 0;
		case '<=':
			return d <= 0;
		case '>':
			return d > 0;
		case '>=':
			return d >= 0;
		case '=':
			return d === 0;
	}
}

/** Whether `version` satisfies `range`. An unparseable version or range never matches. */
export function satisfies(version: string, range: string): boolean {
	const ver = parse(version);
	if (!ver) return false;
	return range.split('||').some((set) => {
		const list = comparators(set);
		if (!list) return false;
		// Like semver, a prerelease only matches a range that names a prerelease of the same version.
		const sameRelease = (c: Comparator) =>
			c.version[3] !== '' && c.version.slice(0, 3).join() === ver.slice(0, 3).join();
		if (ver[3] !== '' && !list.some(sameRelease)) return false;
		return list.every((c) => test(ver, c));
	});
}
