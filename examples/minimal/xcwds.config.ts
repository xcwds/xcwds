import hello from '@xcwds-example/plugin-hello';
import { defineConfig } from '@xcwds/core';
import blocks from '@xcwds/plugin-blocks';
import camera from '@xcwds/plugin-camera';
import qr from '@xcwds/plugin-qr';
import recorder from '@xcwds/plugin-recorder';
import changelog from '@xcwds/plugin-changelog';
import install from '@xcwds/plugin-install';
import lock from '@xcwds/plugin-lock';
import notion from '@xcwds/plugin-notion';
import offline from '@xcwds/plugin-offline';
import settings from '@xcwds/plugin-settings';
import share from '@xcwds/plugin-share';
import shell from '@xcwds/plugin-shell';
import theme from '@xcwds/plugin-theme';
import timers from '@xcwds/plugin-timers';
import tools from '@xcwds/plugin-tools';
import update from '@xcwds/plugin-update';
import vault from '@xcwds/plugin-vault';
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
				},
				{
					id: 'yours',
					name: 'Your apps',
					emoji: '🧩',
					blurb: 'Trackers and checklists you add.',
					routes: ['/my-apps'],
					groups: ['blocks', 'blocks-private']
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
				{
					path: '/utils/recorder',
					emoji: '🎙️',
					name: 'Voice memos',
					blurb: 'Recordings kept here.'
				},
				// Only in the base-path build, which has a Notion relay (NOTION_RELAY in `build:base`).
				...(process.env.NOTION_RELAY
					? [{ path: '/utils/notion', emoji: '🗒️', name: 'Notion', blurb: 'Pages kept here.' }]
					: []),
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
		// Apps people add from templates at /my-apps (#160), each one a tool in the Your apps app.
		blocks({ app: 'yours' }),
		// The base-path build (HELLO_ORIGIN in `build:base`) declares an origin from the options (#103).
		hello({
			greeting: 'hi',
			...(process.env.HELLO_ORIGIN ? { origin: process.env.HELLO_ORIGIN } : {})
		}),
		// What others share arrives at /inbox; it stays private, so it has no Share button. Your apps'
		// pages run apps that are only on this device, so a link to one would open nothing elsewhere.
		share({ target: '/inbox', exclude: ['/inbox', '/settings', '/my-apps'] }),
		settings({
			source: 'https://github.com/xcwds/xcwds',
			backupName: 'minimal-backup',
			width: 'split',
			groups: { tools: 'Pinned tools' },
			// Theme above the shell's navigation, though the shell registers its field first.
			fields: ['theme'],
			sections: { notion: 'Notion' }
		}),
		timers({ page: '/utils/timer' }),
		// Only the apps that are on are kept offline (#163).
		offline({ byApp: true }),
		update(),
		changelog({ entries: notes }),
		theme(),
		install({ text: { heading: 'Install Minimal' } }),
		// A passcode lock for private pages (the Journal), with its unlock screen at /unlock; a cover
		// in the app switcher and no spellcheck in their fields.
		lock(),
		// Sensitive data (the Journal, photos, recordings) encrypted with the lock's passcode (#79,
		// #149). Only in the base-path build (VAULT in `build:base`) for now, where e2e/vault.test.ts
		// runs: the root build's lock tests read what's saved as plaintext.
		...(process.env.VAULT ? [vault()] : []),
		// The camera as `app.camera`, off while hidden or locked; /utils/camera shows `<Camera>`.
		camera({ maxSide: 2048 }),
		// QR codes made and read on the device; /utils/qr shows `<QrScanner>` and `<QrCode>`.
		qr(),
		// Voice memos as `app.recorder` and `app.recordings`; /utils/recorder shows `<Recorder>` and
		// `<Recordings>`.
		recorder(),
		// Notion pages downloaded through the relay as `app.notion` (#106); /utils/notion uses it, and
		// /utils/notion/view shows one copy (`<NotionView>`). Only the base-path build sets a relay,
		// so the root build still contacts no server.
		...(process.env.NOTION_RELAY
			? [notion({ relay: process.env.NOTION_RELAY, page: '/utils/notion' })]
			: [])
	]
});
