import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { XCWDS_VERSIONS } from './versions.js';

const packages = new URL('../../', import.meta.url).pathname;
const script = new URL('../scripts/release-create.js', import.meta.url).pathname;

describe('XCWDS_VERSIONS', () => {
	it('matches every published package in the workspace', () => {
		const versions: Record<string, string> = {};
		for (const dir of readdirSync(packages)) {
			const file = join(packages, dir, 'package.json');
			if (!existsSync(file)) continue;
			const { name, version, private: hidden } = JSON.parse(readFileSync(file, 'utf8'));
			if (!hidden) versions[name] = version;
		}
		expect(Object.keys(versions)).toContain('@xcwds/core');
		expect(XCWDS_VERSIONS).toEqual(versions);
	});
});

describe('release-create.js', () => {
	let root: string;
	const added = () => join(root, '.changeset', 'create-starter-versions.md');
	const changeset = (file: string, source: string) =>
		writeFileSync(join(root, '.changeset', file), source);
	const run = () => execFileSync(process.execPath, [script, root], { encoding: 'utf8' });

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'xcwds-release-'));
		mkdirSync(join(root, '.changeset'));
		changeset('config.json', JSON.stringify({ ignore: ['@xcwds/site'] }));
		changeset('README.md', '# Changesets\n');
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it('bumps create when another package is released', () => {
		changeset(
			'a.md',
			'---\n\'@xcwds/core\': minor\n"@xcwds/plugin-shell": patch\n---\n\nA change.\n'
		);
		run();
		expect(readFileSync(added(), 'utf8')).toMatch(/^---\n'@xcwds\/create': patch\n---\n/);
		// Running again (the workflow rewrites the version PR on every push) changes nothing.
		run();
		expect(readdirSync(join(root, '.changeset')).sort()).toEqual([
			'README.md',
			'a.md',
			'config.json',
			'create-starter-versions.md'
		]);
	});

	it('leaves it when create already has a changeset', () => {
		changeset('a.md', "---\n'@xcwds/core': patch\n---\n\nA.\n");
		changeset('b.md', "---\n'@xcwds/create': minor\n---\n\nB.\n");
		run();
		expect(existsSync(added())).toBe(false);
	});

	it('does nothing without releases, or for ignored packages and empty changesets', () => {
		run();
		changeset('a.md', "---\n'@xcwds/site': patch\n---\n\nSite only.\n");
		changeset('b.md', '---\n---\n');
		run();
		expect(existsSync(added())).toBe(false);
	});
});
