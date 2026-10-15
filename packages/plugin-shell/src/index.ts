/**
 * `@xcwds/plugin-shell`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import shell from '@xcwds/plugin-shell';
 * export default defineConfig({
 * 	brand,
 * 	plugins: [shell({ sections: [{ path: '/', label: 'Home', emoji: '🏠' }] })]
 * });
 * ```
 */
import { XcwdsError, codes, definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type Section, type ShellOptions } from './options.js';

export type { NavSetting, NavStyle, Section, ShellOptions } from './options.js';
export { activeSection, pageInfo, type PageInfo } from './nav.js';

export default descriptor<ShellOptions>(NAME);

/** What this checks of `app.tools` (from `@xcwds/plugin-tools`, if present). */
type ToolsLike = { apps(): readonly { id: string }[] };

/**
 * Checks that each section's `app` is one of `@xcwds/plugin-tools`' apps (#159). Whichever of
 * the two registers second checks: the shell when the tools are already there, otherwise the
 * tools' build entry when it finds `shellSections`. Throws a config error.
 */
export function checkSectionApps(sections: readonly Section[], tools: ToolsLike | undefined) {
	const wanted = sections.flatMap((s) => (s.app ? [s.app] : []));
	if (!wanted.length) return;
	const fail = (message: string): never => {
		throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
	};
	if (!tools) fail('a section has an `app`, which needs @xcwds/plugin-tools.');
	const known = new Set(tools!.apps().map((a) => a.id));
	const missing = wanted.find((id) => !known.has(id));
	if (missing)
		fail(`a section is in the app "${missing}", which isn't in @xcwds/plugin-tools' \`apps\`.`);
}

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-shell`'s build entry: the sections, for other plugins' checks. */
		readonly shellSections?: readonly Section[];
	}
}

/**
 * Checks the options when the config loads, so a mistake fails the build, not the page, and
 * shares the sections so `@xcwds/plugin-tools` can check their apps if it registers later.
 */
export const build = definePlugin(
	(app, input: ShellOptions) => {
		const { sections } = resolveOptions(input);
		app.decorate('shellSections', sections);
		const tools = (app as { tools?: ToolsLike }).tools;
		// The tools come later in the config: their build entry checks.
		if (tools) checkSectionApps(sections, tools);
		else if (sections.some((s) => s.app))
			app.addHook('onConfig', () => {
				// Still no tools once every plugin has registered: warn (hooks can't fail the build).
				if (!(app as { tools?: ToolsLike }).tools)
					app.log.error(`${NAME}: a section has an \`app\`, which needs @xcwds/plugin-tools.`);
			});
	},
	{ name: NAME, core: CORE, network: false, encapsulate: false }
);
