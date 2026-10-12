/**
 * The page entry. Adds the `theme` setting, which the pre-paint script applies before first
 * paint (so a dark theme never flashes light), and applies it again whenever it changes, here
 * or in another tab, and when the OS switches scheme while on `system`.
 *
 * Imported at prerender too, so it only touches browser globals once the app boots.
 */
import { definePlugin } from '@xcwds/core';
import {
	APPLY,
	COLORS_GLOBAL,
	CORE,
	NAME,
	applyTheme,
	isTheme,
	resolveOptions,
	type Theme,
	type ThemeOptions
} from './options.js';

declare module '@xcwds/core' {
	interface Settings {
		/** From `@xcwds/plugin-theme`. */
		theme: Theme;
	}
	interface App {
		/** From `@xcwds/plugin-theme`. */
		readonly theme?: AppTheme;
	}
}

/** `app.theme`. */
export type AppTheme = {
	/** The scheme showing now (`system` resolved against the OS). */
	readonly scheme: 'light' | 'dark';
	/** Calls `listener` now and whenever the scheme changes; returns a function that stops it. */
	subscribe(listener: (scheme: 'light' | 'dark') => void): () => void;
};

export default definePlugin(
	(app, input: ThemeOptions) => {
		const options = resolveOptions(input);
		app.settings.field('theme', {
			default: options.default,
			parse: (v) => (isTheme(v) ? v : undefined),
			label: 'Theme',
			section: 'appearance',
			control: {
				type: 'choice',
				options: [
					{ value: 'system', label: 'System' },
					{ value: 'light', label: 'Light' },
					{ value: 'dark', label: 'Dark' }
				]
			},
			prePaint: APPLY
		});

		let scheme: 'light' | 'dark' = 'light';
		const listeners = new Set<(scheme: 'light' | 'dark') => void>();
		let stops: (() => void)[] = [];
		app.decorate('theme', {
			get scheme() {
				return scheme;
			},
			subscribe(listener) {
				listeners.add(listener);
				listener(scheme);
				return () => void listeners.delete(listener);
			}
		} satisfies AppTheme);

		app.addHook('onBoot', () => {
			const media = window.matchMedia?.('(prefers-color-scheme: dark)');
			const update = () => {
				const colors = (window as unknown as Record<string, unknown>)[COLORS_GLOBAL] as
					Partial<Record<'light' | 'dark', string>> | undefined;
				const next = applyTheme(app.settings.get().theme, document.documentElement, {
					prefersDark: !!media?.matches,
					colors
				});
				if (next === scheme) return;
				scheme = next;
				for (const listener of listeners) listener(scheme);
			};
			update();
			stops.push(app.settings.subscribe(update));
			if (media) {
				media.addEventListener('change', update);
				stops.push(() => media.removeEventListener('change', update));
			}
		});
		app.addHook('onClose', () => {
			for (const stop of stops) stop();
			stops = [];
		});
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
