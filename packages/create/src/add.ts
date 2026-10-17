/**
 * `xcwds add <plugin>`: what `npm create @xcwds` would have done for a plugin, on an existing
 * app. Adds the dependency, the config entry (and its shell section), the plugin's route files,
 * and refreshes the files the starter manages (`src/xcwds.css`, `src/lib/Notices.svelte`).
 */
import { join } from 'node:path';
import { CATALOG, PLUGIN_IDS, callOf, withRequirements, type PluginId } from './catalog.js';
import { addImport, appendToArray, readText, writeFile } from './files.js';
import {
	MANAGED,
	noticesComponent,
	pluginCss,
	pluginImport,
	sectionItem,
	xcwdsDependencies
} from './generate.js';
import { XCWDS_VERSIONS } from './versions.js';

export type AddResult = {
	/** Plugins added (the asked-for ones and what they require), in catalog order. */
	added: PluginId[];
	/** Files written or changed, relative to the app. */
	changed: string[];
	/** Steps the user must do by hand, because a file didn't look as expected. */
	manual: string[];
};

type PackageJson = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

/** The catalog plugins an app's package.json depends on. */
export function installedPlugins(pkg: PackageJson): PluginId[] {
	const deps = { ...pkg.dependencies, ...pkg.devDependencies };
	return PLUGIN_IDS.filter((id) => CATALOG[id].package in deps);
}

export function addPlugins(root: string, requested: readonly string[]): AddResult {
	const pkgFile = join(root, 'package.json');
	const pkgText = readText(pkgFile);
	if (pkgText === undefined) throw new Error(`No package.json in ${root}: run this in your app.`);
	const pkg = JSON.parse(pkgText) as PackageJson & Record<string, unknown>;
	const installed = installedPlugins(pkg);
	const all = withRequirements([...installed, ...requested]);
	const added = all.filter((id) => !installed.includes(id));
	const result: AddResult = { added, changed: [], manual: [] };
	if (!added.length) return result;

	// package.json: the new packages, like the app's other @xcwds dependencies.
	const workspace = pkg.dependencies?.['@xcwds/core']?.startsWith('workspace:') ?? false;
	const deps = { ...pkg.dependencies };
	for (const name of xcwdsDependencies(added))
		deps[name] ??= workspace ? 'workspace:*' : `^${XCWDS_VERSIONS[name]}`;
	pkg.dependencies = Object.fromEntries(
		Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))
	);
	const indentation = /^\{\n([\t ]+)/.exec(pkgText)?.[1] ?? '\t';
	writeFile(pkgFile, `${JSON.stringify(pkg, null, indentation)}\n`);
	result.changed.push('package.json');

	// xcwds.config.ts: imports, the plugin calls and shell sections.
	const configName = [
		'xcwds.config.ts',
		'xcwds.config.js',
		'xcwds.config.mts',
		'xcwds.config.mjs'
	].find((f) => readText(join(root, f)) !== undefined);
	let config = configName ? readText(join(root, configName))! : undefined;
	for (const id of added) {
		const info = CATALOG[id];
		const call = callOf(id, all);
		const next = config && appendToArray(config, /\bplugins\s*:\s*\[/, call);
		if (!config || !next) {
			result.manual.push(
				`Add ${info.package} to your xcwds config: \`${pluginImport(id)}\` and \`${call.replace(/\s*\n\s*/g, ' ')}\` in \`plugins\`.`
			);
			continue;
		}
		config = next;
		for (const line of [pluginImport(id), ...(info.configImports ?? [])])
			config = addImport(config, line);
		if (info.section) {
			const { path, label, emoji } = info.section;
			const item = sectionItem(path, label, emoji);
			// Settings stays last.
			const withSection = appendToArray(
				config,
				/\bsections\s*=\s*\[/,
				item,
				/path:\s*['"]\/settings['"]/
			);
			if (withSection) config = withSection;
			else
				result.manual.push(
					`To show ${label} in the tab bar, add \`${item}\` to the shell's \`sections\`.`
				);
		}
	}
	// Share was there already, so its call is the app's own: say what to add to it.
	if (added.includes('blocks') && installed.includes('share'))
		result.manual.push(
			"Add '/my-apps' to `share({ exclude })` in your xcwds config: a link to a page that runs one of your apps opens nothing on another device."
		);
	if (config !== undefined && configName) {
		writeFile(join(root, configName), config);
		result.changed.push(configName);
	}

	// Route files, never over the app's own.
	for (const id of added)
		for (const file of CATALOG[id].files?.({ name: '', tagline: '', plugins: all }) ?? []) {
			if (readText(join(root, file.path)) !== undefined) continue;
			writeFile(join(root, file.path), file.content);
			result.changed.push(file.path);
		}

	// The managed files, unless the app has made them its own.
	const managed: [string, string, string][] = [
		['src/xcwds.css', pluginCss(all), `@import each plugin's styles in your CSS`],
		['src/lib/Notices.svelte', noticesComponent(all), 'show its notice in your layout']
	];
	for (const [path, content, instead] of managed) {
		const current = readText(join(root, path));
		if (current !== undefined && !current.includes(MANAGED)) {
			const needed = added.filter((id) =>
				path.endsWith('.css') ? CATALOG[id].css : CATALOG[id].notice
			);
			if (needed.length)
				result.manual.push(
					`${path} isn't managed by xcwds add any more: ${instead} (${needed.map((id) => CATALOG[id].package).join(', ')}).`
				);
			continue;
		}
		if (current === content) continue;
		writeFile(join(root, path), content);
		result.changed.push(path);
	}
	return result;
}
