// Adds a patch changeset for @xcwds/create whenever the pending changesets release any other
// package, so every release republishes create with the new versions baked into src/versions.ts
// (#54): create doesn't depend on the other packages, so changesets wouldn't bump it otherwise,
// and `npm create @xcwds` would keep writing the old `^0.x` ranges. Packages only ever get bumped
// as dependents of a package a changeset names, so checking the named ones is enough. Runs before
// `changeset version` in `pnpm version-packages`, from the repository root (or the directory given
// as the first argument); the file it writes is consumed by that same `changeset version`.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CREATE = '@xcwds/create';
const FILE = 'create-starter-versions.md';

const root = process.argv[2] ?? process.cwd();
const dir = join(root, '.changeset');

/** The package names in a changeset's front matter. */
function released(source) {
	const match = /^---\r?\n([\s\S]*?)\r?\n?---/.exec(source);
	if (!match) return [];
	return match[1]
		.split(/\r?\n/)
		.map((line) => /^\s*(['"]?)(.+?)\1\s*:\s*(major|minor|patch)\s*$/.exec(line)?.[2])
		.filter((name) => name !== undefined);
}

const { ignore = [] } = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
const names = readdirSync(dir)
	.filter((file) => file.endsWith('.md') && file !== 'README.md' && file !== FILE)
	.flatMap((file) => released(readFileSync(join(dir, file), 'utf8')));

if (names.includes(CREATE)) {
	console.log(`${CREATE} already has a changeset.`);
} else if (!names.some((name) => !ignore.includes(name))) {
	console.log('No package is being released.');
} else {
	const out = join(dir, FILE);
	if (!existsSync(out)) {
		writeFileSync(
			out,
			`---\n'${CREATE}': patch\n---\n\nNew apps and \`xcwds add\` use the @xcwds versions released with this one.\n`
		);
	}
	console.log(`Added a patch changeset for ${CREATE}.`);
}
