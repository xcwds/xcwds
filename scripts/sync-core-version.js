// Writes @xcwds/core's package.json version into src/version.ts, so the kernel's VERSION (checked
// against plugins' `core` ranges at boot) follows each version bump. Runs in `pnpm version-packages`.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));
const file = 'packages/core/src/version.ts';
const source = readFileSync(file, 'utf8');
const next = source.replace(/VERSION = '[^']*'/, `VERSION = '${version}'`);
if (next === source && !source.includes(`VERSION = '${version}'`)) {
	throw new Error(`Couldn't find VERSION in ${file}`);
}
writeFileSync(file, next);
