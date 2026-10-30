// What CI runs to prove the starter works (#23): generates the tools template into
// examples/starter (git-ignored, inside the workspace so it uses these packages, not npm), adds
// eight plugins with `xcwds add` (qr and scanner bring camera, vault brings lock), sets the Notion
// relay as its README asks, installs, then runs the app's own check, lint, unit and e2e.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const app = `${root}examples/starter`;
const run = (command, args, cwd = root) =>
	execFileSync(command, args, {
		cwd,
		stdio: 'inherit',
		env: { ...process.env, CI: process.env.CI ?? '' }
	});

rmSync(app, { recursive: true, force: true });
run('node', [
	'packages/create/dist/create.js',
	'examples/starter',
	'--yes',
	'--template',
	'tools',
	'--workspace',
	'--no-install',
	'--name',
	'Starter',
	'--tagline',
	"Made by npm create @xcwds's tests."
]);
run(
	'node',
	[
		'../../packages/create/dist/xcwds.js',
		'add',
		'share',
		'changelog',
		'qr',
		'blocks',
		'notion',
		'recorder',
		'scanner',
		'vault',
		'--no-install'
	],
	app
);
// The build refuses the relay placeholder (`https://your-notion-relay.invalid`) until it's set.
const config = `${app}/xcwds.config.ts`;
const placeholder = /https:\/\/your-notion-relay\.invalid/;
const source = readFileSync(config, 'utf8');
if (!placeholder.test(source)) throw new Error('xcwds add notion wrote no relay placeholder.');
writeFileSync(config, source.replace(placeholder, 'https://notion-relay.example'));
run('pnpm', ['install', '--no-frozen-lockfile']);
for (const script of [['check'], ['lint'], ['test:unit', '--run'], ['test:e2e']])
	run('pnpm', script, app);
