import hello from '@xcwds-example/plugin-hello';
import { defineConfig } from '@xcwds/core';
import camera from '@xcwds/plugin-camera';
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
				// Hidden while the Hello app is off (#159).
				{ path: '/hello', label: 'Hello', emoji: '👋', app: 'hello' },
				{ path: '/utils', label: 'Utils', emoji: '🧰' },
				{ path: '/settings', label: 'Settings', emoji: '⚙️' }
			]
		}),
		tools({
			path: '/utils',
			title: 'Utils',
			emoji: '🧰',
			// Apps people turn on and off at /apps (#158). Hello also owns the plugin's page and data.
			apps: [
				{ id: 'kitchen', name: 'Kitchen', emoji: '🍳', blurb: 'Timers for cooking.' },
				{
					id: 'hello',
					name: 'Hello',
					emoji: '👋',
					blurb: 'The example plugin.',
					routes: ['/hello'],
					groups: ['hello']
				}
			],
			items: [
				{
					path: '/utils/coffee',
					emoji: '☕',
					name: 'Coffee Timer',
					blurb: 'A 90-second countdown.',
					shortcut: true,
					app: 'kitchen'
				},
				{ path: '/utils/notes', emoji: '📝', name: 'Notes', blurb: 'A scratch pad.' },
				{
					path: '/utils/timer',
					emoji: '⏲️',
					name: 'Timer',
					blurb: 'Several labeled timers at once.',
					app: 'kitchen'
				},
				{ path: '/utils/dice', emoji: '🎲', name: 'Dice', blurb: 'Roll a die.' },
				{ path: '/utils/units', emoji: '📏', name: 'Units', blurb: 'Convert lengths.' },
				{ path: '/utils/camera', emoji: '📷', name: 'Camera', blurb: 'Photos with no metadata.' },
				{ path: '/utils/qr', emoji: '🔳', name: 'QR code', blurb: 'Show text as a QR code.' },
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
		lock(),
		// The camera as `app.camera`, off while hidden or locked; /utils/camera shows `<Camera>`.
		camera({ maxSide: 2048 })
	]
});
