// Writes @xcwds/core's package.json version into src/version.ts, so the kernel's VERSION (checked
// against plugins' `core` ranges at boot) follows each version bump, and moves the first-party
// plugins' `CORE` range along when core leaves it (a new minor on 0.x, a new major after), so it
// matches the `^` peer range they publish with. Runs in `pnpm version-packages`.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));

/** Replaces `pattern`'s match in `file` with `value`, failing if the file doesn't have one. */
function sync(file, pattern, value) {
	const source = readFileSync(file, 'utf8');
	if (!pattern.test(source)) throw new Error(`Couldn't find ${pattern} in ${file}`);
	writeFileSync(file, source.replace(pattern, value));
}

sync('packages/core/src/version.ts', /VERSION = '[^']*'/, `VERSION = '${version}'`);

const [major, minor] = version.split('.');
const range = major === '0' ? `^0.${minor}.0` : `^${major}.0.0`;
const plugins = readdirSync('packages')
	.filter((name) => name.startsWith('plugin-'))
	.map((name) => `packages/${name}/src/options.ts`);
for (const file of [...plugins, 'examples/plugin-tally/src/options.ts']) {
	sync(file, /CORE = '[^']*'/, `CORE = '${range}'`);
}
