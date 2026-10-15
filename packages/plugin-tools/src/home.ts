/**
 * Home shortcuts, ported from xcwds.github.io's `home.ts`: tools pinned to Home (in the user's
 * order) and the most recently opened ones. Pure functions over a tool list, so the rules are
 * testable; the page entry holds the state.
 */

/** What these rules need from a tool. */
export type ShortcutTool = {
	path: string;
	/** Keeps the tool out of "Recently used". */
	private?: boolean;
};

export type HomeShortcuts = { pins: string[]; recent: string[] };

export const MAX_RECENT = 3;

export const emptyShortcuts = (): HomeShortcuts => ({ pins: [], recent: [] });

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Unique strings from `v`, in order, if it's an array. */
const paths = (v: unknown): string[] =>
	Array.isArray(v) ? [...new Set(v.filter((p): p is string => typeof p === 'string'))] : [];

/** Whether a path ends with a `#fragment`: a tool added at runtime, which may not be there yet. */
const isRuntime = (path: string) => path.includes('#');

/**
 * Validates saved shortcuts. Paths of tools that no longer exist are dropped, and so are recents
 * of private tools: a removed tool never shows on Home, nor a private one under Recently used.
 * Paths with a `#fragment` are kept while their tool is missing, since such tools are added at
 * runtime (after the person's data loads, or an unlock) and removed with `app.tools.remove`;
 * Home only shows the ones that are there.
 */
export function parseShortcuts(
	v: unknown,
	tools: readonly ShortcutTool[]
): HomeShortcuts | undefined {
	if (!isRecord(v)) return undefined;
	const known = new Set(tools.map((t) => t.path));
	const recentOk = new Set(tools.filter((t) => !t.private).map((t) => t.path));
	return {
		pins: paths(v.pins).filter((p) => known.has(p) || isRuntime(p)),
		recent: paths(v.recent)
			.filter((p) => recentOk.has(p) || (!known.has(p) && isRuntime(p)))
			.slice(0, MAX_RECENT)
	};
}

/** Forgets a tool that was removed: its pin and its place under Recently used. */
export function withoutTool(state: HomeShortcuts, path: string): HomeShortcuts {
	return {
		pins: state.pins.filter((p) => p !== path),
		recent: state.recent.filter((p) => p !== path)
	};
}

/** Records opening `path`: most recent first, at most MAX_RECENT; other pages are ignored. */
export function withVisit(
	state: HomeShortcuts,
	path: string,
	tools: readonly ShortcutTool[]
): HomeShortcuts {
	const tool = tools.find((t) => t.path === path);
	if (!tool || tool.private) return state;
	const recent = [path, ...state.recent.filter((p) => p !== path)].slice(0, MAX_RECENT);
	return { ...state, recent };
}

export function withPinToggled(state: HomeShortcuts, path: string): HomeShortcuts {
	const pins = state.pins.includes(path)
		? state.pins.filter((p) => p !== path)
		: [...state.pins, path];
	return { ...state, pins };
}

/** Moves a pin one place up (-1) or down (1); no change at either end. */
export function withPinMoved(state: HomeShortcuts, path: string, by: -1 | 1): HomeShortcuts {
	const i = state.pins.indexOf(path);
	const j = i + by;
	if (i < 0 || j < 0 || j >= state.pins.length) return state;
	const pins = [...state.pins];
	pins.splice(j, 0, ...pins.splice(i, 1));
	return { ...state, pins };
}

export const sameShortcuts = (a: HomeShortcuts, b: HomeShortcuts) =>
	JSON.stringify(a) === JSON.stringify(b);
