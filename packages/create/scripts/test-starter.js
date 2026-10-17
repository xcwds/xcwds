// What CI runs to prove the starter works (#23): generates the tools template into
// examples/starter (git-ignored, inside the workspace so it uses these packages, not npm), adds
// five plugins with `xcwds add` (qr brings camera), installs, then runs the app's own check,
// lint, unit and e2e.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
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
		'--no-install'
	],
	app
);
run('pnpm', ['install', '--no-frozen-lockfile']);
for (const script of [['check'], ['lint'], ['test:unit', '--run'], ['test:e2e']])
	run('pnpm', script, app);
