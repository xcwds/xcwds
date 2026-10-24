#!/usr/bin/env node
/**
 * `npm create @xcwds [dir]`: asks for a name, tagline, icon and plugins (or takes them as flags),
 * writes the app, installs it and says what to do next.
 */
import { readFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
	CATALOG,
	NOTION_RELAY_STEP,
	RECOMMENDED,
	TEMPLATES,
	offered,
	pluginId,
	withRequirements,
	type PluginId,
	type TemplateName
} from './catalog.js';
import { detectPackageManager, install, parseArgs } from './cli.js';
import { writeApp } from './files.js';
import { appFiles, slug } from './generate.js';

const HELP = `npm create @xcwds [dir] -- [options]

Makes a new installable, offline-first PWA on @xcwds.

  --name <name>            The app's name
  --tagline <text>         One line about it
  --icon <file.svg>        A square SVG icon (default: a neutral one)
  --template <name>        minimal (the recommended plugins) or tools (plus tools and timers)
  --plugins <a,b>          Plugins to use instead of a template's (${offered(false).join(', ')})
  -y, --yes                Don't ask: use the defaults for anything not given
  --no-install             Don't install dependencies
  -h, --help               Show this
`;

async function main(argv: string[]) {
	const { positional, flags } = parseArgs(argv, ['yes', 'help', 'no-install', 'workspace']);
	if (flags.has('help')) return void process.stdout.write(HELP);
	const text = (name: string) => {
		const v = flags.get(name);
		return typeof v === 'string' ? v : undefined;
	};
	const template = text('template');
	if (template !== undefined && !(template in TEMPLATES))
		throw new Error(`Unknown template "${template}": use ${Object.keys(TEMPLATES).join(' or ')}.`);
	let plugins: PluginId[] = text('plugins')
		? withRequirements(
				text('plugins')!
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			)
		: [...TEMPLATES[(template as TemplateName | undefined) ?? 'minimal']];
	let name = text('name') ?? (positional[0] ? basename(resolve(positional[0])) : undefined);
	let tagline = text('tagline') ?? '';
	let iconPath = text('icon');
	const ask = !flags.has('yes') && process.stdin.isTTY;

	if (ask) {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		try {
			const question = async (q: string, fallback = '') =>
				(await rl.question(fallback ? `${q} (${fallback}): ` : `${q}: `)).trim() || fallback;
			process.stdout.write('\nA new @xcwds app. Press Enter to keep a default.\n\n');
			if (!text('name')) name = await question('App name', name ?? 'My app');
			if (!text('tagline')) tagline = await question('Tagline, one line (optional)');
			if (!text('icon'))
				iconPath = (await question('Square SVG icon file (Enter for a neutral one)')) || undefined;
			if (!text('plugins') && template === undefined) {
				process.stdout.write('\nPlugins:\n');
				for (const id of offered(flags.has('workspace')))
					process.stdout.write(
						`  [${plugins.includes(id) ? 'x' : ' '}] ${id.padEnd(10)} ${CATALOG[id].summary}\n`
					);
				const extra = await question('\nAdd (comma-separated, e.g. tools,timers)');
				const drop = await question('Leave out (comma-separated)');
				const dropped = new Set(
					drop
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
						.map(pluginId)
				);
				plugins = withRequirements([
					...plugins.filter((id) => !dropped.has(id)),
					...extra
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				]);
			}
		} finally {
			rl.close();
		}
	}

	name = name?.trim() || 'My app';
	const dir = resolve(positional[0] ?? slug(name));
	const icon = iconPath ? readFileSync(resolve(iconPath), 'utf8') : undefined;
	if (icon !== undefined && !/<svg[\s>]/i.test(icon)) throw new Error(`${iconPath} isn't an SVG.`);
	const pm = detectPackageManager();
	writeApp(
		dir,
		appFiles({
			name,
			tagline,
			icon,
			plugins,
			packageManager: pm.name,
			packageManagerVersion: pm.version,
			workspace: flags.has('workspace')
		})
	);
	const where = relative(process.cwd(), dir) || '.';
	process.stdout.write(
		`\nMade ${name} in ${where} with ${withRequirements(plugins).join(', ')}.\n`
	);
	const installed = !flags.has('no-install') && install(pm.name, dir);
	const run = pm.name === 'pnpm' ? 'pnpm' : 'npm run';
	const exec = pm.name === 'pnpm' ? 'pnpm' : 'npx';
	process.stdout.write(`
Next:
  cd ${where}${installed ? '' : `\n  ${pm.name} install`}
  ${run} dev                 # open it at http://localhost:5173
  ${exec} xcwds add <plugin>   # add a plugin (${exec} xcwds add lists them)

Deploy: push to GitHub and set Settings → Pages → Source to "GitHub Actions";
.github/workflows/deploy.yml tests and publishes main. The README says more.
${RECOMMENDED.every((id) => plugins.includes(id)) ? '' : '\nSome recommended plugins are left out; add them with xcwds add.\n'}${plugins.includes('notion') ? `\n${NOTION_RELAY_STEP}\n` : ''}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
});
