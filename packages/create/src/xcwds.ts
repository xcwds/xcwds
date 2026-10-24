#!/usr/bin/env node
/** `xcwds add <plugin...>`: adds first-party plugins to an existing app. */
import { CATALOG, offered } from './catalog.js';
import { addPlugins, installedPlugins } from './add.js';
import { detectPackageManager, install, parseArgs } from './cli.js';
import { readText } from './files.js';

const HELP = `xcwds add <plugin...> [--no-install]

Adds @xcwds plugins to the app in this directory: the dependency, the config entry, its pages
and its styles and notices.
`;

function list() {
	const pkg = JSON.parse(readText('package.json') ?? '{}');
	const installed = installedPlugins(pkg);
	const workspace = pkg.dependencies?.['@xcwds/core']?.startsWith('workspace:') ?? false;
	process.stdout.write('Plugins:\n');
	for (const id of offered(workspace))
		process.stdout.write(
			`  ${installed.includes(id) ? '✓' : ' '} ${id.padEnd(10)} ${CATALOG[id].summary}\n`
		);
}

function main(argv: string[]) {
	const { positional, flags } = parseArgs(argv, ['help', 'no-install']);
	const [command, ...names] = positional;
	if (flags.has('help') || !command) return void process.stdout.write(HELP);
	if (command !== 'add') throw new Error(`Unknown command "${command}".\n\n${HELP}`);
	if (!names.length) return list();
	const result = addPlugins(process.cwd(), names);
	if (!result.added.length) return void process.stdout.write('Nothing to add: already there.\n');
	process.stdout.write(`Added ${result.added.map((id) => CATALOG[id].package).join(', ')}.\n`);
	for (const file of result.changed) process.stdout.write(`  ${file}\n`);
	if (result.manual.length) {
		process.stdout.write('\nTo do by hand:\n');
		for (const step of result.manual) process.stdout.write(`  - ${step}\n`);
	}
	if (!flags.has('no-install')) {
		const pm = detectPackageManager();
		if (!install(pm.name, process.cwd())) process.exitCode = 1;
	}
}

try {
	main(process.argv.slice(2));
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
}
