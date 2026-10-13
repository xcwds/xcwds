/**
 * The first-party plugins the starter knows how to wire up: what each adds to the config, the
 * CSS, the layout's notices and the routes (RFC 0001, decision 2: plugin pages are thin route
 * files in the app).
 */

/** What an app looks like, for the files a plugin writes. */
export type AppPlan = {
	name: string;
	tagline: string;
	/** Plugin ids, in catalog order. */
	plugins: PluginId[];
};

/** A file the plugin's routes need, relative to the app's root. Never overwritten. */
export type RouteFile = { path: string; content: string };

/** A shell section (tab bar and sidebar link) for a page the plugin adds. */
export type Section = { path: string; label: string; emoji: string };

export type PluginInfo = {
	id: PluginId;
	package: string;
	/** Part of the recommended set (pre-selected when creating an app). */
	recommended: boolean;
	/** One line for the picker. */
	summary: string;
	/** Other plugins it needs (added with it). */
	requires: PluginId[];
	/** The call in xcwds.config.ts, e.g. `timers({ page: '/timers' })`, unindented. */
	call: string;
	/** Extra lines for the top of xcwds.config.ts. */
	configImports?: string[];
	/** A CSS file to import after Tailwind. */
	css?: string;
	/** A component for the layout's notice stack, imported as its default export. */
	notice?: { name: string; from: string };
	/** Its pages, for the shell's sections. */
	section?: Section;
	/** Route files (and other files) it needs in the app. */
	files?: (plan: AppPlan) => RouteFile[];
};

export const PLUGIN_IDS = [
	'shell',
	'theme',
	'offline',
	'update',
	'install',
	'settings',
	'tools',
	'timers',
	'share',
	'changelog',
	'lock'
] as const;
export type PluginId = (typeof PLUGIN_IDS)[number];

const page = (body: string, script = '') =>
	`${script ? `<script lang="ts">\n${script}\n</script>\n\n` : ''}${body}\n`;

export const CATALOG: Record<PluginId, PluginInfo> = {
	shell: {
		id: 'shell',
		package: '@xcwds/plugin-shell',
		recommended: true,
		summary: 'Header, tab bar or sidebar, toasts, Home and the error page',
		requires: [],
		// Filled in from the sections of the other plugins.
		call: 'shell({ sections })',
		css: '@xcwds/plugin-shell/styles.css'
	},
	theme: {
		id: 'theme',
		package: '@xcwds/plugin-theme',
		recommended: true,
		summary: 'Light and dark mode, applied before first paint',
		requires: [],
		call: 'theme()',
		css: '@xcwds/plugin-theme/tailwind.css'
	},
	offline: {
		id: 'offline',
		package: '@xcwds/plugin-offline',
		recommended: true,
		summary: 'Works offline, with a notice when the connection drops',
		requires: [],
		call: 'offline()',
		notice: { name: 'OfflineNotice', from: '@xcwds/plugin-offline/OfflineNotice.svelte' }
	},
	update: {
		id: 'update',
		package: '@xcwds/plugin-update',
		recommended: true,
		summary: 'New versions wait for an Update tap, never mid-task',
		requires: [],
		call: 'update()',
		notice: { name: 'UpdateBanner', from: '@xcwds/plugin-update/UpdateBanner.svelte' }
	},
	install: {
		id: 'install',
		package: '@xcwds/plugin-install',
		recommended: true,
		summary: 'An Install button, or the steps on iPhone',
		requires: [],
		call: 'install()'
	},
	lock: {
		id: 'lock',
		package: '@xcwds/plugin-lock',
		recommended: false,
		summary: 'A passcode lock for private pages, a cover over them in the app switcher',
		requires: [],
		call: 'lock()',
		css: '@xcwds/plugin-lock/styles.css',
		files: () => [
			{
				path: 'src/routes/unlock/+page.svelte',
				content: page(
					'<main class="page-narrow pt-2 pb-6">\n\t<UnlockScreen />\n</main>',
					"\timport UnlockScreen from '@xcwds/plugin-lock/UnlockScreen.svelte';"
				)
			}
		]
	},
	settings: {
		id: 'settings',
		package: '@xcwds/plugin-settings',
		recommended: true,
		summary: 'A settings page with backups, Privacy and About',
		requires: ['shell'],
		call: 'settings()',
		css: '@xcwds/plugin-settings/styles.css',
		section: { path: '/settings', label: 'Settings', emoji: '⚙️' },
		files: () => [
			{
				path: 'src/routes/settings/+page.svelte',
				content: page(
					'<main class="page-narrow pt-2 pb-6">\n\t<SettingsPage />\n</main>',
					"\timport SettingsPage from '@xcwds/plugin-settings/SettingsPage.svelte';"
				)
			}
		]
	},
	tools: {
		id: 'tools',
		package: '@xcwds/plugin-tools',
		recommended: false,
		summary: 'Small tools with an index page, pinned and recent ones on Home',
		requires: ['shell'],
		call: `tools({
	path: '/tools',
	title: 'Tools',
	emoji: '🧰',
	items: [
		{ path: '/tools/dice', emoji: '🎲', name: 'Dice', blurb: 'Roll a die.', shortcut: true }
	]
})`,
		css: '@xcwds/plugin-tools/styles.css',
		section: { path: '/tools', label: 'Tools', emoji: '🧰' },
		files: () => [
			{
				path: 'src/routes/tools/+page.svelte',
				content: page(
					'<main class="page-wide flex flex-col gap-6 pt-2 pb-6">\n\t<ToolList />\n</main>',
					"\timport ToolList from '@xcwds/plugin-tools/ToolList.svelte';"
				)
			},
			{ path: 'src/routes/tools/dice/+page.svelte', content: DICE },
			{ path: 'src/lib/dice.ts', content: DICE_LIB },
			{ path: 'src/lib/dice.test.ts', content: DICE_TEST }
		]
	},
	timers: {
		id: 'timers',
		package: '@xcwds/plugin-timers',
		recommended: false,
		summary: 'Labeled timers that ring on every page and survive a sleeping phone',
		requires: ['shell'],
		call: "timers({ page: '/timers' })",
		css: '@xcwds/plugin-timers/styles.css',
		notice: { name: 'TimerAlert', from: '@xcwds/plugin-timers/TimerAlert.svelte' },
		section: { path: '/timers', label: 'Timers', emoji: '⏲️' },
		files: () => [
			{
				path: 'src/routes/timers/+page.svelte',
				content: page(
					'<main class="page-narrow flex flex-col gap-4 pt-2 pb-6">\n\t<TimerList />\n</main>',
					"\timport TimerList from '@xcwds/plugin-timers/TimerList.svelte';"
				)
			}
		]
	},
	share: {
		id: 'share',
		package: '@xcwds/plugin-share',
		recommended: false,
		summary: 'A Share button in the installed app (links only, never your data)',
		requires: ['shell'],
		call: "share({ exclude: ['/settings'] })"
	},
	changelog: {
		id: 'changelog',
		package: '@xcwds/plugin-changelog',
		recommended: false,
		summary: "What's new in Settings, and a toast after an update",
		requires: ['settings'],
		call: 'changelog({ entries: whatsNew })',
		configImports: ["import { changelog as whatsNew } from './src/lib/changelog.js';"],
		css: '@xcwds/plugin-changelog/styles.css',
		files: () => [
			{
				path: 'src/lib/changelog.ts',
				content: `import type { ChangelogEntry } from '@xcwds/plugin-changelog';

/** What's new, newest first: each change people will notice adds one entry with the next id. */
export const changelog: ChangelogEntry[] = [
	{ id: 1, date: '${new Date().toISOString().slice(0, 10)}', items: ['The first version.'] }
];
`
			}
		]
	}
};

const DICE = `<script lang="ts">
	// A tool is just a page: this one rolls a die. Add yours to \`tools({ items })\` in
	// xcwds.config.ts and give it a route like this one.
	import { roll as rollDie } from '$lib/dice';

	let roll = $state<number | null>(null);
</script>

<main class="page-narrow flex flex-col items-start gap-4 pt-2">
	<p data-testid="roll">{roll === null ? 'Tap to roll.' : \`You rolled \${roll}.\`}</p>
	<button
		type="button"
		class="rounded-xl bg-(--xcwds-shell-card) px-4 py-2"
		onclick={() => (roll = rollDie())}
	>
		Roll
	</button>
</main>
`;

const DICE_LIB = `/** A roll of a die with \`sides\` sides, from 1 to \`sides\`. */
export function roll(sides = 6, random = Math.random): number {
	return 1 + Math.floor(random() * sides);
}
`;

const DICE_TEST = `import { expect, it } from 'vitest';
import { roll } from './dice.js';

it('rolls from 1 to the number of sides', () => {
	expect(roll(6, () => 0)).toBe(1);
	expect(roll(6, () => 0.999)).toBe(6);
	expect(roll(20, () => 0.5)).toBe(11);
});
`;

/** The plugin ids for `ids` with everything they require, in catalog order. */
export function withRequirements(ids: readonly string[]): PluginId[] {
	const wanted = new Set<PluginId>();
	const visit = (input: string) => {
		const id = pluginId(input);
		if (wanted.has(id)) return;
		wanted.add(id);
		for (const dep of CATALOG[id].requires) visit(dep);
	};
	// Every page the starter writes lives in the shell.
	for (const id of ['shell', ...ids]) visit(id);
	return PLUGIN_IDS.filter((id) => wanted.has(id));
}

export function isPluginId(id: string): id is PluginId {
	return (PLUGIN_IDS as readonly string[]).includes(id);
}

/** Accepts `timers`, `plugin-timers` and `@xcwds/plugin-timers`. */
export function pluginId(input: string): PluginId {
	const id = input.replace(/^@xcwds\//, '').replace(/^plugin-/, '');
	if (!isPluginId(id))
		throw new Error(`Unknown plugin "${input}". Known: ${PLUGIN_IDS.join(', ')}.`);
	return id;
}

export const RECOMMENDED: PluginId[] = PLUGIN_IDS.filter((id) => CATALOG[id].recommended);

/** Starting points for `--template`. */
export const TEMPLATES = {
	minimal: RECOMMENDED,
	tools: [...RECOMMENDED, 'tools', 'timers']
} satisfies Record<string, PluginId[]>;
export type TemplateName = keyof typeof TEMPLATES;
