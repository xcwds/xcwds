// What `pnpm version-packages` is about to release, worked out the way changesets would, so that
// `peer-dependent-changesets.js` and `check-release-plan.js` can fix and check its peer bumps
// (#229). Shared by those scripts and `packages/create/scripts/release-create.js`.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';

const ORDER = ['none', 'patch', 'minor', 'major'];

/** The start of the changesets `peer-dependent-changesets.js` writes. */
export const PREFIX = 'generated-peer-';
/** Where `peer-dependent-changesets.js` keeps the plan before `changeset version` for the check. */
export const PLAN = join('node_modules', '.cache', 'xcwds', 'release-plan.json');

/** The higher of two bump types. */
export function higher(a = 'none', b = 'none') {
	return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

/** `{ name, type }` for each package in a changeset's front matter. */
export function released(source) {
	const match = /^---\r?\n([\s\S]*?)\r?\n?---/.exec(source);
	if (!match) return [];
	return match[1]
		.split(/\r?\n/)
		.map((line) => /^\s*(['"]?)(.+?)\1\s*:\s*(major|minor|patch)\s*$/.exec(line))
		.filter((found) => found !== null)
		.map((found) => ({ name: found[2], type: found[3] }));
}

/** The changeset files in `dir` (every `.md` but the README), by file name. */
export function changesetFiles(dir) {
	return readdirSync(dir)
		.filter((file) => file.endsWith('.md') && file !== 'README.md')
		.sort();
}

/** The highest bump the changesets in `dir` ask for, by package name. */
export function requestedBumps(dir) {
	const bumps = {};
	for (const file of changesetFiles(dir)) {
		for (const { name, type } of released(readFileSync(join(dir, file), 'utf8'))) {
			bumps[name] = higher(bumps[name], type);
		}
	}
	return bumps;
}

/** `ignore` from `.changeset/config.json` (exact package names). */
export function ignored(root) {
	const { ignore = [] } = JSON.parse(readFileSync(join(root, '.changeset', 'config.json'), 'utf8'));
	return ignore;
}

/**
 * The published packages' manifests (`packages/*`, the only place they live), by name. Private and
 * ignored packages are left out: changesets never releases them, and fails the whole version step on
 * a changeset that names an ignored one.
 */
export function publishedPackages(root) {
	const skip = new Set(ignored(root));
	const packages = {};
	const dir = join(root, 'packages');
	for (const name of readdirSync(dir).sort()) {
		const file = join(dir, name, 'package.json');
		if (!existsSync(file)) continue;
		const manifest = JSON.parse(readFileSync(file, 'utf8'));
		if (manifest.private || skip.has(manifest.name)) continue;
		packages[manifest.name] = manifest;
	}
	return packages;
}

/** The range a dependency spec publishes with while `version` is the dependency's version. */
export function publishedRange(spec, version) {
	if (!spec.startsWith('workspace:')) return spec;
	const range = spec.slice('workspace:'.length);
	if (range === '^' || range === '~') return `${range}${version}`;
	if (range === '*') return version;
	return range;
}

/** The bump that's breaking for a package at `version`: a minor on 0.x, a major from 1.0. */
export function breaking(version) {
	return semver.major(version) === 0 ? 'minor' : 'major';
}

/** Whether going from `from` to `to` is a breaking release (see `breaking`). */
export function isBreaking(from, to) {
	if (semver.major(to) > semver.major(from)) return true;
	return semver.major(from) === 0 && semver.minor(to) > semver.minor(from);
}

/**
 * The bumps peer dependents need on top of `requested`, by package name: whenever a package's next
 * version leaves the range a published package peers on it with, that package gets a breaking bump
 * (`breaking`), which can in turn push its own peer dependents out of range, so this repeats until
 * nothing changes. Each entry lists its `causes`: the peers, their next version and the new range.
 *
 * @param {Record<string, any>} packages from `publishedPackages`
 * @param {Record<string, string>} requested from `requestedBumps`
 */
export function peerBumps(packages, requested) {
	/** @type {Record<string, string>} */
	const bumps = {};
	for (const [name, type] of Object.entries(requested)) {
		if (packages[name]) bumps[name] = type;
	}
	/** @type {Record<string, { type: string, causes: { name: string, version: string, range: string }[] }>} */
	const added = {};
	let changed = true;
	while (changed) {
		changed = false;
		for (const [peer, type] of Object.entries(bumps)) {
			if (type === 'none') continue;
			const version = semver.inc(packages[peer].version, type);
			for (const [name, manifest] of Object.entries(packages)) {
				const spec = manifest.peerDependencies?.[peer];
				if (!spec) continue;
				const range = publishedRange(spec, packages[peer].version);
				if (semver.satisfies(version, range)) continue;
				const entry = (added[name] ??= { type: breaking(manifest.version), causes: [] });
				// A later pass can raise the peer's own bump, so its cause is replaced, never kept stale.
				const cause = { name: peer, version, range: publishedRange(spec, version) };
				const known = entry.causes.findIndex((item) => item.name === peer);
				if (known === -1) entry.causes.push(cause);
				else entry.causes[known] = cause;
				const next = higher(bumps[name], entry.type);
				if (next !== bumps[name]) {
					bumps[name] = next;
					changed = true;
				}
			}
		}
	}
	return added;
}
