import hello from '@xcwds-example/plugin-hello';
import { defineConfig } from '@xcwds/core';
import changelog from '@xcwds/plugin-changelog';
import install from '@xcwds/plugin-install';
import lock from '@xcwds/plugin-lock';
import offline from '@xcwds/plugin-offline';
import settings from '@xcwds/plugin-settings';
import share from '@xcwds/plugin-share';
import shell from '@xcwds/plugin-shell';
import theme from '@xcwds/plugin-theme';
import timers from '@xcwds/plugin-timers';
import tools from '@xcwds/plugin-tools';
import update from '@xcwds/plugin-update';
import { changelog as notes } from './src/lib/changelog.js';

export default defineConfig({
	brand: {
		name: 'Minimal',
		tagline: 'The smallest @xcwds app.',
		icon: 'icon.svg',
		themeColor: { light: '#dbeafe', dark: '#030712' }
	},
	plugins: [
		shell({
			sections: [
				{ path: '/', label: 'Home', emoji: '🏠' },
				{ path: '/hello', label: 'Hello', emoji: '👋' },
				{ path: '/utils', label: 'Utils', emoji: '🧰' },
				{ path: '/settings', label: 'Settings', emoji: '⚙️' }
			]
		}),
		tools({
			path: '/utils',
			title: 'Utils',
			emoji: '🧰',
			items: [
				{
					path: '/utils/coffee',
					emoji: '☕',
					name: 'Coffee Timer',
					blurb: 'A 90-second countdown.',
					shortcut: true
				},
				{ path: '/utils/notes', emoji: '📝', name: 'Notes', blurb: 'A scratch pad.' },
				{
					path: '/utils/timer',
					emoji: '⏲️',
					name: 'Timer',
					blurb: 'Several labeled timers at once.'
				},
				{ path: '/utils/dice', emoji: '🎲', name: 'Dice', blurb: 'Roll a die.' },
				{ path: '/utils/units', emoji: '📏', name: 'Units', blurb: 'Convert lengths.' },
				// Private: never under Recently used, shared or a shortcut; named discreetly.
				{
					path: '/utils/journal',
					emoji: '📓',
					name: 'Journal',
					blurb: 'Private notes.',
					private: true
				}
			]
		}),
		// The base-path build (HELLO_ORIGIN in `build:base`) declares an origin from the options (#103).
		hello({
			greeting: 'hi',
			...(process.env.HELLO_ORIGIN ? { origin: process.env.HELLO_ORIGIN } : {})
		}),
		// What others share arrives at /inbox; it stays private, so it has no Share button.
		share({ target: '/inbox', exclude: ['/inbox', '/settings'] }),
		settings({
			source: 'https://github.com/xcwds/xcwds',
			backupName: 'minimal-backup',
			width: 'split',
			groups: { tools: 'Pinned tools' }
		}),
		timers({ page: '/utils/timer' }),
		offline(),
		update(),
		changelog({ entries: notes }),
		theme(),
		install(),
		// A passcode lock for private pages (the Journal), with its unlock screen at /unlock; a cover
		// in the app switcher and no spellcheck in their fields.
		lock()
	]
});
