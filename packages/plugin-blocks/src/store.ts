/**
 * Your apps, saved on the device (#160): `app.blocks`. Definitions are two lists, one for normal
 * apps (`app:blocks:apps`, backed up) and one for private ones (`app:blocks:private-apps`,
 * personal); each app's data has its own key (`app:blocks:data:<id>`, or
 * `app:blocks:private:<id>` for a private app). Every write checks its result, and a failed one
 * leaves what was saved as it was.
 */
import type { Entry, PrefixEntry, StorageScope } from '@xcwds/core';
import { emptyData, parseData, type AppData } from './data.js';
import { ID, newId, parseApp, type AppDefinition, type Parsed } from './format.js';

/** An app as lists show it. */
export interface AppSummary {
	id: string;
	name: string;
	emoji?: string;
	private: boolean;
	/** The page that runs it: `<path>/app#<id>`, or `<path>/private#<id>`. */
	path: string;
}

export type Saved = { ok: true; app: AppDefinition } | { ok: false; error: string };

export interface Removed {
	ok: boolean;
	/** Puts the app and its data back, as an Undo does; false if that couldn't be saved. */
	restore(): boolean;
}

export interface Blocks {
	/** Where Your apps lives, e.g. `/my-apps`. */
	readonly path: string;
	/** What "Add from a template" offers. */
	readonly templates: readonly AppDefinition[];
	/** Your apps, normal ones first, each list in the order it was saved. */
	list(): AppSummary[];
	get(id: string): AppDefinition | undefined;
	/** The page that runs an app. */
	pathOf(app: Pick<AppDefinition, 'id' | 'private'>): string;
	/** An app's data, read against its definition (empty when there's none or no app). */
	data(id: string): AppData;
	/** Saves an app's data; false if it couldn't be saved (or there's no such app). */
	saveData(id: string, data: AppData): boolean;
	/**
	 * Adds an app or replaces the one with its id, after checking it. Turning an app private (or
	 * back) moves its definition and data to their new keys: the new ones are written first and
	 * the old ones removed after, so a failed write leaves the app where it was.
	 */
	save(input: unknown): Saved;
	/** Adds a copy of a template with a new id. */
	addFromTemplate(template: AppDefinition): Saved;
	/** Removes an app and its data. `restore` undoes it while the Undo shows. */
	remove(id: string): Removed;
	/** Your apps or their data changed: saved here, by another tab, cleared or imported. */
	onChange(listener: () => void): () => void;
}

const NOT_SAVED = "Couldn't save. Your device's storage may be full or blocked.";

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** A saved list of definitions, keeping the valid ones (a broken one can't hide the rest). */
function parseList(raw: unknown): AppDefinition[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const apps: AppDefinition[] = [];
	for (const item of raw) {
		const parsed = parseApp(item);
		if (parsed.ok && !apps.some((a) => a.id === parsed.value.id)) apps.push(parsed.value);
	}
	return apps;
}

/** Saved data is checked against the app's definition when it's read (`parseData`). */
const parseSaved = (raw: unknown): AppData | undefined =>
	isObject(raw) && isObject(raw.blocks) && typeof raw.format === 'number'
		? (raw as unknown as AppData)
		: undefined;

export interface BlocksEntries {
	apps: Entry<AppDefinition[]>;
	privateApps: Entry<AppDefinition[]>;
	data: PrefixEntry<AppData>;
	privateData: PrefixEntry<AppData>;
}

/** Registers the plugin's storage entries in its namespace (once, in the plugin's setup). */
export function registerEntries(storage: StorageScope): BlocksEntries {
	return {
		apps: storage.entry('apps', { label: 'Your apps', group: 'blocks', parse: parseList }),
		data: storage.entry('data', {
			label: 'Your apps: data',
			group: 'blocks',
			prefix: true,
			parse: parseSaved
		}),
		// Personal: a lock's reset clears the whole group, and the apps go with their data.
		privateApps: storage.entry('private-apps', {
			label: 'Your private apps',
			group: 'blocks-private',
			sensitive: true,
			parse: parseList
		}),
		privateData: storage.entry('private', {
			label: 'Your private apps: data',
			group: 'blocks-private',
			sensitive: true,
			prefix: true,
			parse: parseSaved
		})
	};
}

export function createBlocks(
	storage: StorageScope,
	entries: BlocksEntries,
	options: { path: string; templates: readonly AppDefinition[] }
): Blocks {
	const { path, templates } = options;
	const listeners = new Set<() => void>();
	/** Storage only reports other tabs' changes; this tab's own saves are announced here. */
	const changed = (saved: boolean) => {
		if (saved) for (const listener of [...listeners]) listener();
		return saved;
	};
	const listOf = (priv: boolean) => (priv ? entries.privateApps : entries.apps);
	const dataOf = (priv: boolean, id: string) => (priv ? entries.privateData : entries.data).at(id);
	const read = (priv: boolean) => storage.read(listOf(priv)) ?? [];

	/** Private wins if a switch was cut short and an app is in both lists. */
	function find(id: string): AppDefinition | undefined {
		return read(true).find((a) => a.id === id) ?? read(false).find((a) => a.id === id);
	}

	const pathOf = (app: Pick<AppDefinition, 'id' | 'private'>) =>
		`${path}/${app.private ? 'private' : 'app'}#${app.id}`;

	/** Applies `change` to one list (from what's saved now, so another tab's change isn't lost). */
	function updateList(priv: boolean, change: (list: AppDefinition[]) => AppDefinition[]): boolean {
		const entry = listOf(priv);
		const { saved } = storage.update(entry, undefined, (latest) => {
			const next = change(latest ?? []);
			return next.length ? next : undefined;
		});
		return storage.saveResult(entry, saved, { explicit: true });
	}

	const write = <T>(entry: Entry<T>, value: T) =>
		storage.saveResult(entry, storage.write(entry, value), { explicit: true });

	function save(input: unknown): Saved {
		const parsed: Parsed<AppDefinition> = parseApp(input);
		if (!parsed.ok) return parsed;
		const app = parsed.value;
		const before = find(app.id);
		const replace = (list: AppDefinition[]) => {
			const at = list.findIndex((a) => a.id === app.id);
			return at < 0 ? [...list, app] : list.map((a, i) => (i === at ? app : a));
		};
		if (!before || before.private === app.private) {
			return changed(updateList(app.private, replace))
				? { ok: true, app }
				: { ok: false, error: NOT_SAVED };
		}
		// Moving between normal and private: new keys first, then the old ones go.
		const oldData = storage.read(dataOf(before.private, app.id));
		const newData = dataOf(app.private, app.id);
		if (oldData && !write(newData, oldData)) return { ok: false, error: NOT_SAVED };
		if (!updateList(app.private, replace)) {
			if (oldData) storage.remove(newData);
			return { ok: false, error: NOT_SAVED };
		}
		if (!updateList(before.private, (list) => list.filter((a) => a.id !== app.id))) {
			// Can't take it off the old list: put things back as they were.
			updateList(app.private, (list) => list.filter((a) => a.id !== app.id));
			if (oldData) storage.remove(newData);
			return { ok: false, error: NOT_SAVED };
		}
		storage.remove(dataOf(before.private, app.id));
		changed(true);
		return { ok: true, app };
	}

	return {
		path,
		templates,
		list() {
			const normal = read(false);
			const personal = read(true);
			return [...normal.filter((a) => !personal.some((p) => p.id === a.id)), ...personal].map(
				(a) => ({
					id: a.id,
					name: a.name,
					...(a.emoji ? { emoji: a.emoji } : {}),
					private: a.private,
					path: pathOf(a)
				})
			);
		},
		get: find,
		pathOf,
		data(id) {
			const app = find(id);
			if (!app) return emptyData();
			return parseData(app, storage.read(dataOf(app.private, id)));
		},
		saveData(id, data) {
			const app = find(id);
			return app ? changed(write(dataOf(app.private, id), data)) : false;
		},
		save,
		addFromTemplate: (template) => save({ ...template, id: newId() }),
		remove(id) {
			const app = ID.test(id) ? find(id) : undefined;
			if (!app) return { ok: false, restore: () => false };
			const list = read(app.private);
			const at = list.findIndex((a) => a.id === id);
			const dataEntry = dataOf(app.private, id);
			const data = storage.read(dataEntry);
			if (!updateList(app.private, (l) => l.filter((a) => a.id !== id)))
				return { ok: false, restore: () => true };
			storage.remove(dataEntry);
			changed(true);
			return {
				ok: true,
				restore() {
					if (data && !write(dataEntry, data)) return false;
					return changed(
						updateList(app.private, (l) =>
							l.some((a) => a.id === id) ? l : [...l.slice(0, at), app, ...l.slice(at)]
						)
					);
				}
			};
		},
		onChange(listener) {
			const keys = [entries.apps.key, entries.privateApps.key];
			const prefixes = [entries.data.key, entries.privateData.key];
			listeners.add(listener);
			const stop = storage.onChange((key) => {
				if (key === null || keys.includes(key) || prefixes.some((p) => key.startsWith(p)))
					listener();
			});
			return () => {
				listeners.delete(listener);
				stop();
			};
		}
	};
}
