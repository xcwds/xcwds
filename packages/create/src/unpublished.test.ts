import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Every plugin in the catalog is on npm now; this stands in for the next one that isn't yet.
vi.mock('./versions.js', async (original) => {
	const versions = await original<typeof import('./versions.js')>();
	const { '@xcwds/plugin-notion': _, ...published } = versions.XCWDS_VERSIONS;
	return { ...versions, XCWDS_VERSIONS: published };
});

const { addPlugins } = await import('./add.js');
const { TEMPLATES, isPublished, offered } = await import('./catalog.js');
const { writeApp } = await import('./files.js');
const { appFiles } = await import('./generate.js');

let root: string;
beforeEach(async () => (root = await mkdtemp(join(tmpdir(), 'xcwds-unpublished-'))));
afterEach(() => rm(root, { recursive: true, force: true }));

it('offers unpublished plugins only inside this repository', () => {
	expect(isPublished('notion')).toBe(false);
	expect(offered(false)).not.toContain('notion');
	expect(offered(false)).toContain('blocks');
	expect(offered(true)).toContain('notion');
	expect(() => appFiles({ name: 'Box', plugins: ['notion'] })).toThrow(
		"@xcwds/plugin-notion isn't published yet"
	);
	expect(appFiles({ name: 'Box', plugins: ['notion'], workspace: true }).size).toBeGreaterThan(0);
});

it('adds an unpublished plugin only to an app that depends on the workspace', () => {
	writeApp(root, appFiles({ name: 'Box', plugins: TEMPLATES.minimal }));
	const pkgFile = join(root, 'package.json');
	const before = readFileSync(pkgFile, 'utf8');
	expect(() => addPlugins(root, ['notion'])).toThrow("isn't published yet");
	expect(readFileSync(pkgFile, 'utf8')).toBe(before);
});
