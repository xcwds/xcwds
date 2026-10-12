import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { satisfies } from './semver.js';
import { VERSION } from './version.js';

// The first-party packages and the guide's example plugin, checked against this kernel (#53).
const ROOT = resolve(import.meta.dirname, '../../..');
const dirs = [
	...readdirSync(join(ROOT, 'packages')).map((name) => join(ROOT, 'packages', name)),
	join(ROOT, 'examples/plugin-tally'),
	join(ROOT, 'examples/plugin-hello')
];
const read = (file: string) => readFileSync(file, 'utf8');
const plugins = dirs.filter((dir) => existsSync(join(dir, 'src/options.ts')));

describe('first-party packages', () => {
	it('peer on @xcwds/core, so an app never gets a second kernel', () => {
		const users = dirs.filter((dir) => read(join(dir, 'package.json')).includes('"@xcwds/core"'));
		expect(users.length).toBeGreaterThan(10);
		for (const dir of users) {
			const pkg = JSON.parse(read(join(dir, 'package.json')));
			if (pkg.name === '@xcwds/core') continue;
			expect(pkg.dependencies?.['@xcwds/core'], dir).toBeUndefined();
			expect(pkg.peerDependencies?.['@xcwds/core'], dir).toBe('workspace:^');
		}
	});

	it("declare the core range their peer dependency publishes with, in every entry's metadata", () => {
		const [major, minor] = VERSION.split('.');
		const range = major === '0' ? `^0.${minor}.0` : `^${major}.0.0`;
		expect(plugins.length).toBeGreaterThan(10);
		for (const dir of plugins) {
			expect(read(join(dir, 'src/options.ts')), dir).toContain(`export const CORE = '${range}';`);
			for (const entry of ['index.ts', 'client.ts', 'worker.ts']) {
				const file = join(dir, 'src', entry);
				if (!existsSync(file)) continue;
				const source = read(file);
				const calls = source.match(/\bdefinePlugin\(/g)?.length ?? 0;
				expect(calls, file).toBeGreaterThan(0);
				expect(source.match(/\bcore: CORE\b/g)?.length ?? 0, file).toBe(calls);
			}
		}
		expect(satisfies(VERSION, range)).toBe(true);
	});
});
