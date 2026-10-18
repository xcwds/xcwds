import { execFileSync, spawnSync } from 'node:child_process';
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
import { PLAN, peerBumps } from './release-plan.js';

const fix = new URL('./peer-dependent-changesets.js', import.meta.url).pathname;
const check = new URL('./check-release-plan.js', import.meta.url).pathname;

let root;

/** Writes a package under `packages/` with its peers on other workspace packages. */
function pkg(name, version, peers = {}, extra = {}) {
	const dir = join(root, 'packages', name.replace(/^@xcwds\//, ''));
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({ name, version, peerDependencies: peers, ...extra })
	);
}

/** Sets a package's version, as `changeset version` would. */
function bump(name, version) {
	const file = join(root, 'packages', name.replace(/^@xcwds\//, ''), 'package.json');
	writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), version }));
}

const changeset = (file, source) => writeFileSync(join(root, '.changeset', file), source);
const generated = () =>
	Object.fromEntries(
		readdirSync(join(root, '.changeset'))
			.filter((file) => file.startsWith('generated-peer-'))
			.sort()
			.map((file) => [file, readFileSync(join(root, '.changeset', file), 'utf8')])
	);
const run = (script) => spawnSync(process.execPath, [script, root], { encoding: 'utf8' });

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'xcwds-peers-'));
	mkdirSync(join(root, '.changeset'));
	changeset('config.json', JSON.stringify({ ignore: ['@xcwds/plugin-vault'] }));
	changeset('README.md', '# Changesets\n');
	pkg('@xcwds/core', '0.4.0');
	pkg('@xcwds/sveltekit', '0.5.0', { '@xcwds/core': 'workspace:^' });
	pkg('@xcwds/plugin-shell', '0.5.0', {
		'@xcwds/core': 'workspace:^',
		'@xcwds/sveltekit': 'workspace:^'
	});
	pkg('@xcwds/plugin-settings', '0.5.0', {
		'@xcwds/core': 'workspace:^',
		'@xcwds/plugin-shell': 'workspace:^',
		'@xcwds/sveltekit': 'workspace:^'
	});
	pkg('@xcwds/plugin-camera', '0.2.0', { '@xcwds/core': 'workspace:^' });
	pkg('@xcwds/plugin-qr', '0.2.0', {
		'@xcwds/core': 'workspace:^',
		'@xcwds/plugin-camera': 'workspace:^'
	});
	pkg('@xcwds/plugin-vault', '0.0.0', { '@xcwds/core': 'workspace:^' });
	pkg('@xcwds/example', '0.0.0', { '@xcwds/core': 'workspace:^' }, { private: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('peer-dependent-changesets.js', () => {
	it('gives every peer dependent of a minor its next minor, one file per cause', () => {
		changeset('a.md', "---\n'@xcwds/sveltekit': minor\n---\n\nA.\n");
		expect(run(fix).status).toBe(0);
		expect(generated()).toEqual({
			'generated-peer-plugin-shell.md':
				"---\n'@xcwds/plugin-settings': minor\n---\n\nNeeds `@xcwds/plugin-shell` 0.6 (peer range `^0.6.0`).\n",
			'generated-peer-sveltekit.md':
				"---\n'@xcwds/plugin-settings': minor\n'@xcwds/plugin-shell': minor\n---\n\nNeeds `@xcwds/sveltekit` 0.6 (peer range `^0.6.0`).\n"
		});
	});

	it('follows dependents of dependents, and never names ignored or private packages', () => {
		changeset('a.md', "---\n'@xcwds/core': minor\n---\n\nA.\n");
		run(fix);
		const files = generated();
		expect(Object.keys(files)).toEqual([
			'generated-peer-core.md',
			'generated-peer-plugin-camera.md',
			'generated-peer-plugin-shell.md',
			'generated-peer-sveltekit.md'
		]);
		expect(files['generated-peer-plugin-camera.md']).toContain("'@xcwds/plugin-qr': minor");
		expect(Object.values(files).join('')).not.toMatch(/plugin-vault|example/);
	});

	it('does nothing for patches, or without changesets', () => {
		run(fix);
		changeset('a.md', "---\n'@xcwds/core': patch\n---\n\nA.\n");
		expect(run(fix).stdout).toContain('No peer dependent needs a bump.');
		expect(generated()).toEqual({});
	});

	it('gives a dependent from 1.0 on a major', () => {
		bump('@xcwds/plugin-camera', '1.2.0');
		changeset('a.md', "---\n'@xcwds/core': minor\n---\n\nA.\n");
		run(fix);
		expect(generated()['generated-peer-core.md']).toContain("'@xcwds/plugin-camera': major");
	});

	it('refuses to overwrite a changeset with a generated name', () => {
		changeset('a.md', "---\n'@xcwds/sveltekit': minor\n---\n\nA.\n");
		changeset('generated-peer-sveltekit.md', "---\n'@xcwds/sveltekit': patch\n---\n\nMine.\n");
		const result = run(fix);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('already exists');
	});

	it('writes the same files for the same input', () => {
		changeset('a.md', "---\n'@xcwds/core': minor\n---\n\nA.\n");
		run(fix);
		const first = generated();
		for (const file of Object.keys(first)) rmSync(join(root, '.changeset', file));
		run(fix);
		expect(generated()).toEqual(first);
	});
});

describe('peerBumps', () => {
	const packages = {
		'@xcwds/core': { version: '0.4.0' },
		'@xcwds/plugin-a': { version: '0.3.0', peerDependencies: { '@xcwds/core': 'workspace:^' } }
	};

	it('keeps a requested major and records the peer that caused the bump', () => {
		const bumps = peerBumps(packages, { '@xcwds/core': 'major', '@xcwds/plugin-a': 'major' });
		expect(bumps['@xcwds/plugin-a']).toEqual({
			type: 'minor',
			causes: [{ name: '@xcwds/core', version: '1.0.0', range: '^1.0.0' }]
		});
	});

	it('reads exact, tilde and plain ranges', () => {
		const peers = (spec) => ({
			...packages,
			'@xcwds/plugin-a': { version: '0.3.0', peerDependencies: { '@xcwds/core': spec } }
		});
		expect(
			peerBumps(peers('workspace:*'), { '@xcwds/core': 'patch' })['@xcwds/plugin-a']
		).toBeTruthy();
		expect(peerBumps(peers('workspace:~'), { '@xcwds/core': 'patch' })).toEqual({});
		expect(peerBumps(peers('>=0.4.0 <1.0.0'), { '@xcwds/core': 'minor' })).toEqual({});
	});
});

describe('check-release-plan.js', () => {
	it('passes a plan where every dependent got its next minor', () => {
		changeset('a.md', "---\n'@xcwds/core': patch\n'@xcwds/sveltekit': minor\n---\n\nA.\n");
		run(fix);
		bump('@xcwds/core', '0.4.1');
		bump('@xcwds/sveltekit', '0.6.0');
		bump('@xcwds/plugin-shell', '0.6.0');
		bump('@xcwds/plugin-settings', '0.6.0');
		const result = run(check);
		expect(result.status).toBe(0);
		expect(existsSync(join(root, PLAN))).toBe(false);
	});

	it('fails on a 1.0.0 no changeset asked for, and on a peer bump released as a patch', () => {
		changeset('a.md', "---\n'@xcwds/sveltekit': minor\n---\n\nA.\n");
		run(fix);
		bump('@xcwds/sveltekit', '0.6.0');
		bump('@xcwds/plugin-shell', '1.0.0');
		bump('@xcwds/plugin-settings', '0.5.1');
		const result = run(check);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('@xcwds/plugin-shell 0.5.0 → 1.0.0');
		expect(result.stderr).toContain(
			'@xcwds/plugin-settings 0.5.0 → 0.5.1 (@xcwds/plugin-shell 1.0.0 leaves ^0.5.0)'
		);
	});

	it('allows a 1.0.0 a changeset asked for', () => {
		changeset('a.md', "---\n'@xcwds/plugin-qr': major\n---\n\nStable.\n");
		run(fix);
		bump('@xcwds/plugin-qr', '1.0.0');
		expect(run(check).status).toBe(0);
	});

	it('fails without the saved plan', () => {
		expect(() => execFileSync(process.execPath, [check, root], { stdio: 'pipe' })).toThrow(
			/release-plan\.json is missing/
		);
	});
});
