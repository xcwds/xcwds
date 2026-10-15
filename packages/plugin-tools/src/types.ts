import type { AppsSetting } from './apps.js';
import type { HomeShortcuts } from './home.js';
import type { AppGroup, Tool } from './options.js';

/** Home's pinned and recently used tools (`app.tools.shortcuts`, page only). */
export type ToolShortcuts = {
	/** Empty until the app boots and loads what's saved. */
	readonly state: HomeShortcuts;
	/** Calls `listener` now and on every change; returns a function that stops it. */
	subscribe(listener: (state: HomeShortcuts) => void): () => void;
	/** Pins or unpins a tool, with a toast; false if it couldn't be saved. */
	togglePin(path: string): boolean;
	/** Moves a pin one place up (-1) or down (1). */
	movePin(path: string, by: -1 | 1): boolean;
	/** Records opening a page; only tools that aren't private become Recently used. */
	visit(path: string): void;
	/** Re-reads what's saved (after this tab cleared or imported data). */
	reload(): void;
};

/** `app.tools`, in the build and the page entry. */
export type AppTools = {
	/** The index page's path. */
	readonly index: string;
	/** The tools that show, in order: in no app, or in an app that's on (every tool in the build). */
	list(): readonly Tool[];
	/** Every tool, in order, including those of apps that are off. */
	all(): readonly Tool[];
	get(path: string): Tool | undefined;
	/** The apps from the options, in order. */
	apps(): readonly AppGroup[];
	/** The Apps page's path, when there are apps. */
	readonly catalog: string | undefined;
	/** The app a page belongs to (its tool's app, or one whose `routes` cover it). */
	appOf(path: string): AppGroup | undefined;
	/** Whether an app is on (in the build, whether it starts on). */
	isOn(id: string): boolean;
	/** Turns an app on or off and saves it; false if it couldn't be saved (always, in the build). */
	setOn(id: string, on: boolean): boolean;
	/** Calls `listener` now and whenever an app is turned on or off; returns a function that stops it. */
	subscribe(listener: () => void): () => void;
	/**
	 * Adds a tool. Call it while plugins register, from both your build entry (which adds its
	 * page to the route registry, so don't also `app.route()` it) and your page entry.
	 */
	add(tool: Tool): void;
	/** Only in the page. */
	readonly shortcuts?: ToolShortcuts;
};

declare module '@xcwds/core' {
	interface Settings {
		/** From `@xcwds/plugin-tools`: which apps are on, by id (a missing id: the app's default). */
		apps: AppsSetting;
	}
	interface App {
		/** From `@xcwds/plugin-tools`. */
		readonly tools?: AppTools;
	}
}
