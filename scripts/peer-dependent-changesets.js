// Gives peer dependents the bump changesets won't (#229). When a package's next version leaves the
// range another package peers on it with (a core or sveltekit minor, on 0.x), that package has to be
// released again with the new range, which is a breaking change for it. Changesets 2 makes that a
// major (1.0.0 for our 0.x plugins) and changesets 3 a patch, so this writes a changeset giving each
// such package a minor (a major from 1.0), one file per package that caused it:
// `.changeset/generated-peer-<name>.md`, read and deleted by the `changeset version` that follows.
//
// It also saves what was pending for `check-release-plan.js`, which checks the result once
// `changeset version` has run. Runs in `pnpm version-packages`, from the repository root (or the
// directory given as the first argument).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import semver from 'semver';
import { PLAN, PREFIX, peerBumps, publishedPackages, requestedBumps } from './release-plan.js';

const root = process.argv[2] ?? process.cwd();
const dir = join(root, '.changeset');
const packages = publishedPackages(root);
const requested = requestedBumps(dir);

const plan = join(root, PLAN);
mkdirSync(dirname(plan), { recursive: true });
const versions = Object.fromEntries(
	Object.entries(packages).map(([name, { version }]) => [name, version])
);
writeFileSync(plan, JSON.stringify({ versions, requested }, null, '\t') + '\n');

/** Changeset front matter and body for each package that pushed others out of range. */
const files = {};
for (const [name, { type, causes }] of Object.entries(peerBumps(packages, requested))) {
	for (const cause of causes) {
		(files[cause.name] ??= { version: cause.version, ranges: new Set(), lines: [] }).lines.push(
			`'${name}': ${type}`
		);
		files[cause.name].ranges.add(cause.range);
	}
}

const written = [];
for (const peer of Object.keys(files).sort()) {
	const { version, ranges, lines } = files[peer];
	const file = join(
		dir,
		`${PREFIX}${peer.replace(/^@[^/]+\//, '').replace(/[^a-z0-9.-]/gi, '-')}.md`
	);
	if (existsSync(file)) {
		throw new Error(
			`${file} already exists. Delete it if an earlier run that stopped before \`changeset version\` left it, or rename it if it's a changeset you wrote.`
		);
	}
	// Every dependent publishes the same range in practice (`workspace:^`); name it when that holds.
	const range = ranges.size === 1 ? ` (peer range \`${[...ranges][0]}\`)` : '';
	const minor = `${semver.major(version)}.${semver.minor(version)}`;
	writeFileSync(
		file,
		`---\n${lines.sort().join('\n')}\n---\n\nNeeds \`${peer}\` ${minor}${range}.\n`
	);
	written.push(file);
}

console.log(
	written.length
		? `Gave peer dependents their bump in ${written.length} changeset(s).`
		: 'No peer dependent needs a bump.'
);
