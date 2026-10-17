import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as prettier from 'prettier';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addPlugins } from './add.js';
import { TEMPLATES, withRequirements } from './catalog.js';
import { appendToArray, addImport, writeApp } from './files.js';
import { appFiles, quote, slug } from './generate.js';

/** Whether prettier, with the app's own config, would leave `content` as it is. */
async function formatted(path: string, content: string, rc: string) {
	if (!/\.(ts|js|svelte|json|css|md|yml|html)$/.test(path) && !path.startsWith('.prettierrc'))
		return true;
	if (path === 'src/app.html') return true; // SvelteKit's placeholders aren't HTML prettier knows
	const options = { ...JSON.parse(rc), filepath: path };
	return (await prettier.format(content, options)) === content;
}

describe('appFiles', () => {
	for (const [template, plugins] of Object.entries(TEMPLATES))
		it(`writes the ${template} template as prettier would`, async () => {
			const files = appFiles({ name: 'Pocket Box', tagline: "Don't phone home.", plugins });
			const rc = files.get('.prettierrc')!;
			const unformatted: string[] = [];
			for (const [path, content] of files)
				if (!(await formatted(path, content, rc))) unformatted.push(path);
			expect(unformatted).toEqual([]);
		});

	it('stays formatted with a long name and tagline that have quotes and newlines', async () => {
		const name = `The "Very" Long Name Of Somebody's Pocket Toolbox\nFor Every Day ${'and night '.repeat(6)}`;
		const files = appFiles({
			name,
			tagline: `${'A tagline '.repeat(15)}\n'x'`,
			plugins: TEMPLATES.tools
		});
		const rc = files.get('.prettierrc')!;
		const unformatted: string[] = [];
		for (const [path, content] of files)
			if (!(await formatted(path, content, rc))) unformatted.push(path);
		expect(unformatted).toEqual([]);
		expect(files.get('xcwds.config.ts')).toContain(
			`name: 'The "Very" Long Name Of Somebody\\'s Pocket Toolbox For Every Day and night`
		);
	});

	it('pins pnpm in the workflow when the version is unknown', () => {
		const loose = appFiles({ name: 'A', plugins: [] }).get('.github/workflows/deploy.yml')!;
		expect(loose).toContain('pnpm/action-setup@v4\n        with:\n          version: 10');
		const pinned = appFiles({ name: 'A', plugins: [], packageManagerVersion: 'pnpm@10.28.0' });
		expect(pinned.get('.github/workflows/deploy.yml')).not.toContain('version: 10');
		expect(JSON.parse(pinned.get('package.json')!).packageManager).toBe('pnpm@10.28.0');
		const npm = appFiles({ name: 'A', plugins: [], packageManager: 'npm' });
		expect(npm.get('.github/workflows/deploy.yml')).toContain('npm ci');
		expect(npm.has('pnpm-workspace.yaml')).toBe(false);
	});

	it('lets esbuild run its install script under pnpm 10 and later', () => {
		const files = appFiles({ name: 'A', plugins: [] });
		expect(files.get('pnpm-workspace.yaml')).toContain('allowBuilds:\n  esbuild: true');
		expect(files.get('pnpm-workspace.yaml')).toContain('onlyBuiltDependencies:\n  - esbuild');
		expect(JSON.parse(files.get('package.json')!).pnpm).toBeUndefined();
		// Inside the monorepo, the root's pnpm-workspace.yaml applies.
		expect(appFiles({ name: 'A', plugins: [], workspace: true }).has('pnpm-workspace.yaml')).toBe(
			false
		);
	});

	it('wires up the picked plugins and their requirements', () => {
		const files = appFiles({ name: 'Box', plugins: ['changelog', 'timers'] });
		expect(withRequirements(['changelog', 'timers'])).toEqual([
			'shell',
			'settings',
			'timers',
			'changelog'
		]);
		const config = files.get('xcwds.config.ts')!;
		expect(config).toContain("import timers from '@xcwds/plugin-timers';");
		expect(config).toContain("import { changelog as whatsNew } from './src/lib/changelog.js';");
		expect(config).toContain("\t\ttimers({ page: '/timers' }),");
		expect(config).toContain("\t{ path: '/timers', label: 'Timers', emoji: '⏲️' }");
		expect(files.get('src/xcwds.css')).toContain("@import '@xcwds/plugin-timers/styles.css';");
		expect(files.get('src/lib/Notices.svelte')).toContain('<TimerAlert />');
		expect(files.has('src/routes/timers/+page.svelte')).toBe(true);
		expect(files.has('src/routes/tools/+page.svelte')).toBe(false);
		const pkg = JSON.parse(files.get('package.json')!);
		expect(pkg.name).toBe('box');
		expect(Object.keys(pkg.dependencies)).toEqual([
			'@xcwds/core',
			'@xcwds/plugin-changelog',
			'@xcwds/plugin-settings',
			'@xcwds/plugin-shell',
			'@xcwds/plugin-timers',
			'@xcwds/sveltekit'
		]);
		expect(pkg.dependencies['@xcwds/core']).toMatch(/^\^\d/);
		expect(pkg.devDependencies['@sveltejs/kit']).toMatch(/\d/);
	});

	it('wires up the camera and QR codes, with QR bringing the camera', () => {
		expect(withRequirements(['qr'])).toEqual(['shell', 'camera', 'qr']);
		const files = appFiles({ name: 'Box', plugins: ['qr'] });
		const config = files.get('xcwds.config.ts')!;
		expect(config).toContain("import camera from '@xcwds/plugin-camera';");
		expect(config).toContain("import qr from '@xcwds/plugin-qr';");
		expect(config).toContain('\t\tcamera(),');
		expect(config).toMatch(/\t\tqr\(\),?\n/);
		expect(config).toContain("\t{ path: '/camera', label: 'Camera', emoji: '📷' }");
		expect(config).toContain("\t{ path: '/qr', label: 'QR', emoji: '🔳' }");
		const css = files.get('src/xcwds.css')!;
		expect(css).toContain("@import '@xcwds/plugin-camera/styles.css';");
		expect(css).toContain("@import '@xcwds/plugin-qr/styles.css';");
		expect(files.get('src/routes/camera/+page.svelte')).toContain('<Camera onCapture={keep} />');
		expect(files.get('src/routes/camera/+page.svelte')).toContain('`app.photos`');
		expect(files.get('src/routes/qr/+page.svelte')).toContain('<QrScanner');
		const pkg = JSON.parse(files.get('package.json')!);
		expect(pkg.dependencies['@xcwds/plugin-camera']).toMatch(/^\^\d/);
		expect(pkg.dependencies['@xcwds/plugin-qr']).toMatch(/^\^\d/);
	});

	it('depends on the workspace for this repository CI, and quotes names safely', () => {
		const files = appFiles({ name: "Bob's {app}", plugins: [], workspace: true });
		expect(JSON.parse(files.get('package.json')!).dependencies['@xcwds/core']).toBe('workspace:*');
		expect(files.get('xcwds.config.ts')).toContain(`name: "Bob's {app}"`);
		expect(quote(`it's "x"`)).toBe(`'it\\'s "x"'`);
		expect(() => appFiles({ name: ' ', plugins: [] })).toThrow('needs a name');
		expect(() => appFiles({ name: 'x', plugins: ['nope'] })).toThrow('Unknown plugin "nope"');
	});

	it('names packages from app names', () => {
		expect(slug('Pocket Box!')).toBe('pocket-box');
		expect(slug('Café Ñu')).toBe('cafe-nu');
		expect(slug('☕')).toBe('xcwds-app');
	});
});

describe('array and import edits', () => {
	it('appends to arrays, keeping commas and indentation', () => {
		const src = "export default {\n\tplugins: [\n\t\ta(), // 'x]'\n\t\tb({ c: [1] })\n\t]\n};\n";
		expect(appendToArray(src, /plugins:\s*\[/, 'd({\n\te: 1\n})')).toBe(
			"export default {\n\tplugins: [\n\t\ta(), // 'x]'\n\t\tb({ c: [1] }),\n\t\td({\n\t\t\te: 1\n\t\t})\n\t]\n};\n"
		);
		expect(appendToArray('const p = [\n\ta,\n];', /p = \[/, 'b')).toBe(
			'const p = [\n\ta,\n\tb,\n];'
		);
		expect(appendToArray('x = { plugins: [] }', /plugins:\s*\[/, 'a()')).toBe(
			'x = { plugins: [\n\ta()\n] }'
		);
		expect(
			appendToArray(
				"s = [\n\t{ path: '/' },\n\t{ path: '/settings' }\n];",
				/s = \[/,
				"{ path: '/t' }",
				/\/settings/
			)
		).toBe("s = [\n\t{ path: '/' },\n\t{ path: '/t' },\n\t{ path: '/settings' }\n];");
		expect(appendToArray('nothing here', /plugins:\s*\[/, 'a()')).toBeNull();
	});

	it('adds imports after the last one', () => {
		expect(
			addImport("import a from 'a';\nimport {\n\tb\n} from 'b';\n\nrest", "import c from 'c';")
		).toBe("import a from 'a';\nimport {\n\tb\n} from 'b';\nimport c from 'c';\n\nrest");
	});
});

describe('addPlugins', () => {
	let root: string;
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'xcwds-create-'));
	});
	afterEach(() => rm(root, { recursive: true, force: true }));

	it('adds a plugin to a generated app as if it had been picked at the start', async () => {
		writeApp(root, appFiles({ name: 'Box', plugins: TEMPLATES.minimal, workspace: true }));
		const result = addPlugins(root, ['timers', 'tools']);
		expect(result.added).toEqual(['tools', 'timers']);
		expect(result.manual).toEqual([]);
		const fresh = appFiles({ name: 'Box', plugins: TEMPLATES.tools, workspace: true });
		for (const path of [
			'xcwds.config.ts',
			'src/xcwds.css',
			'src/lib/Notices.svelte',
			'src/routes/timers/+page.svelte',
			'src/routes/tools/dice/+page.svelte'
		])
			expect(readFileSync(join(root, path), 'utf8'), path).toBe(fresh.get(path));
		const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
		expect(pkg.dependencies['@xcwds/plugin-timers']).toBe('workspace:*');
		expect(addPlugins(root, ['@xcwds/plugin-timers']).added).toEqual([]);
	});

	it('leaves files the app has taken over, and says what to do', () => {
		writeApp(root, appFiles({ name: 'Box', plugins: [] }));
		const css = join(root, 'src/xcwds.css');
		writeFileSync(css, "@import '@xcwds/plugin-shell/styles.css';\n");
		const result = addPlugins(root, ['timers']);
		expect(readFileSync(css, 'utf8')).toBe("@import '@xcwds/plugin-shell/styles.css';\n");
		expect(result.manual).toEqual([
			"src/xcwds.css isn't managed by xcwds add any more: @import each plugin's styles in your CSS (@xcwds/plugin-timers)."
		]);
		expect(() => addPlugins(join(root, 'missing'), ['timers'])).toThrow('No package.json');
	});
});
