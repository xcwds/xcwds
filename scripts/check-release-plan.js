// Checks the versions `changeset version` just wrote (#229), and fails `pnpm version-packages`,
// naming the packages, rather than let a Version packages PR publish:
//
// - a 0.x package as 1.0.0 or later that no changeset asked a major for (changesets 2 does that to
//   peer dependents), or
// - a package whose peer left the range it publishes today without a breaking release (a minor on
//   0.x, a major from 1.0) for it (changesets 3 makes those patches, and
//   `peer-dependent-changesets.js` should have prevented it).
//
// Changesets 2 makes 1.0.0s on every core or sveltekit minor whatever this repository does, so with
// it installed the first rule only warns and points at the hand edit in `.changeset/README.md`.
// Runs in `pnpm version-packages` after `changeset version`, from the repository root (or the
// directory given as the first argument), with the plan `peer-dependent-changesets.js` saved.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import { PLAN, isBreaking, publishedPackages, publishedRange } from './release-plan.js';

const root = process.argv[2] ?? process.cwd();
const plan = join(root, PLAN);
if (!existsSync(plan)) {
	throw new Error(
		`${PLAN} is missing: run scripts/peer-dependent-changesets.js before changeset version.`
	);
}
const { versions, requested } = JSON.parse(readFileSync(plan, 'utf8'));
rmSync(plan);

const cli = join(root, 'node_modules', '@changesets', 'cli', 'package.json');
const legacy = existsSync(cli) && semver.major(JSON.parse(readFileSync(cli, 'utf8')).version) < 3;

const packages = publishedPackages(root);
const unasked = [];
const unbroken = [];
for (const [name, manifest] of Object.entries(packages)) {
	const before = versions[name];
	if (!before) continue;
	if (
		semver.major(before) === 0 &&
		semver.major(manifest.version) > 0 &&
		requested[name] !== 'major'
	) {
		unasked.push(`${name} ${before} → ${manifest.version}`);
	}
	if (isBreaking(before, manifest.version)) continue;
	for (const [peer, spec] of Object.entries(manifest.peerDependencies ?? {})) {
		if (!versions[peer] || !packages[peer]) continue;
		const range = publishedRange(spec, versions[peer]);
		if (!semver.satisfies(packages[peer].version, range)) {
			unbroken.push(
				`${name} ${before} → ${manifest.version} (${peer} ${packages[peer].version} leaves ${range})`
			);
		}
	}
}

if (unasked.length && legacy) {
	console.warn(
		`Changesets 2 released these as 1.0.0 or later without a major changeset:\n  ${unasked.join('\n  ')}\n` +
			'Hand-edit the Version packages PR before merging it (.changeset/README.md, #90) until #230 moves to changesets 3.'
	);
}
const problems = [
	...(legacy || !unasked.length
		? []
		: [
				'Released as 1.0.0 or later without a major changeset:',
				...unasked.map((line) => `  ${line}`)
			]),
	...(unbroken.length
		? [
				'Needed a breaking release for a peer that left their range:',
				...unbroken.map((line) => `  ${line}`)
			]
		: [])
];
if (problems.length) {
	console.error(problems.join('\n'));
	process.exit(1);
}
console.log('Release plan checked.');
