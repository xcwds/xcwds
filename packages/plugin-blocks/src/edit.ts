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
			const { value } = saved as CounterData;
			if (block.reset === 'never' && now.reset !== 'never' && value > 0)
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
