/**
 * Editing an app (#161): what a change to its definition would drop from its saved data, and the
 * data it keeps. Fields, items and options are matched by id, so renaming one keeps its data;
 * removing a block or field, changing a type, or narrowing what a field accepts drops the data
 * that no longer fits. The builder asks first (`dataLoss`), and saving removes that data
 * (`pruneData`) rather than leaving it hidden in storage.
 */
import type { CounterData } from './counter.js';
import { parseData, type AppData, type BlockData } from './data.js';
import { newId, type AppDefinition, type Block, type LogField, type LogBlock } from './format.js';
import type { LogData } from './log.js';

/** Something a change would drop, for the builder's "this will remove…" question. */
export type Loss =
	/** A block removed (or turned into another type) that has data. */
	| { kind: 'block'; block: string }
	/** A counter that never reset starts resetting: its running `count` starts again at 0. */
	| { kind: 'count'; block: string; count: number; reset: 'daily' | 'weekly' }
	/** A log field removed: `count` entries have a value for it. */
	| { kind: 'field'; block: string; field: string; count: number }
	/** A log field given another type: its `count` values go. */
	| { kind: 'type'; block: string; field: string; count: number }
	/** A field's options or limits changed, and `count` values no longer fit. */
	| { kind: 'values'; block: string; field: string; count: number };

const values = (n: number) => (n === 1 ? '1 value' : `${n} values`);
const entries = (n: number) => (n === 1 ? '1 entry' : `${n} entries`);

/** A loss as a sentence, quoting the labels as they were. */
export function lossText(loss: Loss): string {
	switch (loss.kind) {
		case 'block':
			return `“${loss.block}” and everything saved in it.`;
		case 'count':
			return `The count of “${loss.block}” so far (${loss.count}), because it now starts again each ${loss.reset === 'daily' ? 'day' : 'week'}.`;
		case 'field':
			return `“${loss.field}” in “${loss.block}”, from ${entries(loss.count)}.`;
		case 'type':
			return `${values(loss.count)} of “${loss.field}” in “${loss.block}”, because its type changes.`;
		case 'values':
			return `${values(loss.count)} of “${loss.field}” in “${loss.block}” that no longer fit.`;
	}
}

/** Whether a block's saved data holds anything a person would miss. */
function hasData(data: BlockData | undefined): boolean {
	if (!data) return false;
	if ('done' in data) return Object.keys(data.done).length > 0;
	if ('entries' in data) return data.entries.length > 0;
	if ('text' in data) return data.text.trim() !== '';
	return data.value > 0 || data.history.length > 0;
}

const byId = <T extends { id: string }>(list: readonly T[]) =>
	new Map(list.map((item) => [item.id, item]));

/** The blocks of `after` that keep their data: the same id and the same type as before. */
function kept(before: Block, after: Block | undefined): after is Block {
	return after !== undefined && after.type === before.type;
}

/**
 * The data `after` keeps from `data` (read against `before`): blocks removed or of another type
 * go, log values of a field whose type changed go, and the rest is read against `after`, which
 * drops removed fields, items and options and values outside a field's new limits.
 */
export function pruneData(before: AppDefinition, after: AppDefinition, data: AppData): AppData {
	const next = byId(after.blocks);
	const raw: AppData = { format: data.format, blocks: {} };
	for (const block of before.blocks) {
		const saved = data.blocks[block.id];
		const now = next.get(block.id);
		if (!saved || !kept(block, now)) continue;
		if (block.type === 'log' && now.type === 'log') {
			const fields = byId(now.fields);
			const changed = new Set(
				block.fields.filter((f) => fields.get(f.id)?.type !== f.type).map((f) => f.id)
			);
			raw.blocks[block.id] = {
				entries: (saved as LogData).entries.map((e) => ({
					...e,
					values: Object.fromEntries(Object.entries(e.values).filter(([id]) => !changed.has(id)))
				}))
			};
		} else raw.blocks[block.id] = saved;
	}
	return parseData(after, raw);
}

/** What saving `after` over `before` would drop from `data`; empty when nothing goes. */
export function dataLoss(before: AppDefinition, after: AppDefinition, data: AppData): Loss[] {
	const pruned = pruneData(before, after, data);
	const next = byId(after.blocks);
	const losses: Loss[] = [];
	for (const block of before.blocks) {
		const saved = data.blocks[block.id];
		if (!hasData(saved)) continue;
		const now = next.get(block.id);
		if (!kept(block, now)) {
			losses.push({ kind: 'block', block: block.label });
			continue;
		}
		if (block.type === 'counter' && now.type === 'counter') {
			// A count that never reset has no day or week to file it under, so it isn't kept.
			const { period, value } = saved as CounterData;
			if (period === 'all' && now.reset !== 'never' && value > 0)
				losses.push({ kind: 'count', block: block.label, count: value, reset: now.reset });
			continue;
		}
		if (block.type !== 'log' || now.type !== 'log') continue;
		const left = (pruned.blocks[block.id] as LogData | undefined)?.entries ?? [];
		losses.push(...fieldLosses(block, now, (saved as LogData).entries, left));
	}
	return losses;
}

function fieldLosses(
	before: LogBlock,
	after: LogBlock,
	saved: LogData['entries'],
	left: LogData['entries']
): Loss[] {
	const fields = byId(after.fields);
	const remaining = new Map(left.map((e) => [e.id, e]));
	const losses: Loss[] = [];
	for (const field of before.fields) {
		const count = saved.filter(
			(e) => e.values[field.id] !== undefined && remaining.get(e.id)?.values[field.id] === undefined
		).length;
		if (count === 0) continue;
		const now = fields.get(field.id);
		const kind = !now ? 'field' : now.type !== field.type ? 'type' : 'values';
		losses.push({ kind, block: before.label, field: field.label, count });
	}
	return losses;
}

/** A new, empty app for the builder (not valid until it has a name). */
export function blankApp(): AppDefinition {
	return { format: 1, id: newId(), name: '', private: false, blocks: [] };
}

/** A new block of `type` with a starting label and, for a log, one field. */
export function blankBlock(type: Block['type']): Block {
	const id = newId();
	switch (type) {
		case 'checklist':
			return { id, type, label: 'Checklist', items: [] };
		case 'counter':
			return { id, type, label: 'Counter', reset: 'never' };
		case 'log':
			return { id, type, label: 'Log', fields: [blankField('number')] };
		case 'notes':
			return { id, type, label: 'Notes' };
	}
}

/** A new log field of `type`, labelled after it. */
export function blankField(type: LogField['type']): LogField {
	const id = newId();
	switch (type) {
		case 'number':
			return { id, type, label: 'Number' };
		case 'scale':
			return { id, type, label: 'Rating', max: 5 };
		case 'choice':
			return { id, type, label: 'Choice', options: [{ id: newId(), label: 'Option 1' }] };
		case 'yesno':
			return { id, type, label: 'Yes or no' };
		case 'text':
			return { id, type, label: 'Note' };
		case 'time':
			return { id, type, label: 'Time' };
	}
}

/** `list` with the item at `index` moved by `by` places (Move up is -1); unchanged at an end. */
export function move<T>(list: readonly T[], index: number, by: number): T[] {
	const to = index + by;
	if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
	const next = [...list];
	const [item] = next.splice(index, 1);
	next.splice(to, 0, item as T);
	return next;
}

/** An app being built or edited, kept until it's saved or discarded (#161). */
export interface Draft {
	/** The id of the app it edits, or `''` for a new app. */
	for: string;
	/** The definition as it stands: not checked yet, so a name or label can still be empty. */
	app: AppDefinition;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown) => typeof v === 'string';
const isList = (v: unknown, each: (item: unknown) => boolean) => Array.isArray(v) && v.every(each);
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
const isNumber = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const hasId = (v: unknown): v is Record<string, unknown> =>
	isObject(v) && isText(v.id) && isText(v.label);

function isRepeat(v: unknown): boolean {
	if (!isObject(v)) return false;
	if (v.repeat === 'daily') return true;
	if (v.repeat === 'weekly') return isList(v.weekdays, (d) => Number.isInteger(d));
	return v.repeat === 'every' && isNumber(v.days);
}

function isField(v: unknown): boolean {
	if (!hasId(v)) return false;
	switch (v.type) {
		case 'number':
			return optional(v.unit, isText) && optional(v.min, isNumber) && optional(v.max, isNumber);
		case 'scale':
			return (v.max === 5 || v.max === 10) && optional(v.low, isText) && optional(v.high, isText);
		case 'choice':
			return isList(v.options, hasId);
		case 'yesno':
		case 'text':
		case 'time':
			return true;
		default:
			return false;
	}
}

function isBlock(v: unknown): boolean {
	if (!hasId(v)) return false;
	switch (v.type) {
		case 'checklist':
			return isList(v.items, (i) => hasId(i) && optional(i.repeat, isRepeat));
		case 'counter':
			return (
				(v.reset === 'never' || v.reset === 'daily' || v.reset === 'weekly') &&
				optional(v.goal, isNumber) &&
				optional(v.unit, isText)
			);
		case 'log':
			return isList(v.fields, isField);
		case 'notes':
			return true;
		default:
			return false;
	}
}

/**
 * Reads a saved draft back. Unlike `parseApp` it allows what a builder can hold mid-edit (an
 * empty name or label, a goal that isn't whole yet), but only shapes the builder can show; a
 * draft that isn't one is dropped. `parseApp` still checks it at Save.
 */
export function parseDraft(raw: unknown): Draft | undefined {
	if (!isObject(raw) || !isText(raw.for) || !isObject(raw.app)) return undefined;
	const app = raw.app;
	const ok =
		app.format === 1 &&
		isText(app.id) &&
		isText(app.name) &&
		optional(app.emoji, isText) &&
		typeof app.private === 'boolean' &&
		isList(app.blocks, isBlock);
	return ok ? { for: raw.for as string, app: app as unknown as AppDefinition } : undefined;
}
