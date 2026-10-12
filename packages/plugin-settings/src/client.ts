/**
 * The page entry: `app.settingsPage`, where plugins add whole sections to the settings page
 * (Install, What's new) and custom controls for their fields, and the page's options.
 *
 * Imported at prerender too, so it never touches browser globals.
 */
import { definePlugin } from '@xcwds/core';
import type { Component } from 'svelte';
import {
	CORE,
	NAME,
	resolveOptions,
	type ResolvedSettingsOptions,
	type SettingsOptions
} from './options.js';

/**
 * A section a plugin adds, in `order`: fields are at 0, Your data at 100, Privacy at 150 and About
 * at 200.
 */
export type PageSection = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component: Component<any>;
	props?: Record<string, unknown>;
	order: number;
};

/** A component that shows one settings field; it gets the field's `name` as a prop. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FieldComponent = Component<any>;

/** `app.settingsPage`. */
export type AppSettingsPage = {
	readonly options: ResolvedSettingsOptions;
	/** Adds a section; returns a function that removes it. */
	add(
		component: PageSection['component'],
		options?: { props?: Record<string, unknown>; order?: number }
	): () => void;
	/** Shows the field `name` with `component` instead of its `control`. */
	control(name: string, component: FieldComponent): () => void;
	sections(): readonly PageSection[];
	controls(): ReadonlyMap<string, FieldComponent>;
	/** Calls `listener` now and whenever sections or controls change. */
	subscribe(listener: () => void): () => void;
};

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-settings`. */
		readonly settingsPage?: AppSettingsPage;
	}
}

export default definePlugin(
	(app, input: SettingsOptions) => {
		const options = resolveOptions(input);
		let sections: PageSection[] = [];
		const controls = new Map<string, FieldComponent>();
		const listeners = new Set<() => void>();
		const changed = () => {
			for (const listener of listeners) listener();
		};
		app.decorate('settingsPage', {
			options,
			add(component, { props, order = 50 } = {}) {
				const section: PageSection = { component, ...(props ? { props } : {}), order };
				// Stable: equal orders keep the order they were added in.
				sections = [...sections, section].sort((a, b) => a.order - b.order);
				changed();
				return () => {
					sections = sections.filter((s) => s !== section);
					changed();
				};
			},
			control(name, component) {
				controls.set(name, component);
				changed();
				return () => {
					if (controls.get(name) !== component) return;
					controls.delete(name);
					changed();
				};
			},
			sections: () => sections,
			controls: () => controls,
			subscribe(listener) {
				listeners.add(listener);
				listener();
				return () => void listeners.delete(listener);
			}
		} satisfies AppSettingsPage);
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
