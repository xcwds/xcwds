/**
 * An app's saved data: one record per block, by block id, versioned with the definition format.
 * `parseData` reads it back against the app's current definition, so data for a removed block,
 * an item or field that no longer exists, or a value the definition no longer allows is dropped
 * rather than shown.
 */
import { isDayKey } from './calendar.js';
import type { ChecklistData } from './checklist.js';
import { HISTORY, type CounterData } from './counter.js';
import { FORMAT, LIMITS, type AppDefinition, type Block } from './format.js';
import { isEntry, parseValues, type LogData } from './log.js';

export interface NotesData {
	text: string;
}

export type BlockData = ChecklistData | CounterData | LogData | NotesData;

export interface AppData {
	format: typeof FORMAT;
	blocks: Record<string, BlockData>;
}

export const emptyData = (): AppData => ({ format: FORMAT, blocks: {} });

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const isPeriod = (v: unknown): v is string => v === 'all' || isDayKey(v);

const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function blockData(block: Block, raw: unknown): BlockData | undefined {
	if (!isObject(raw)) return undefined;
	switch (block.type) {
		case 'checklist': {
			if (!isObject(raw.done)) return undefined;
			const done: ChecklistData['done'] = {};
			for (const item of block.items) {
				const day = raw.done[item.id];
				if (isDayKey(day)) done[item.id] = day;
			}
			return { done };
		}
		case 'counter': {
			if (!isPeriod(raw.period) || !count(raw.value)) return undefined;
			const history = Array.isArray(raw.history)
				? raw.history
						.filter(
							(h): h is CounterData['history'][number] =>
								isObject(h) && isDayKey(h.period) && count(h.value)
						)
						.slice(0, HISTORY)
						.map((h) => ({ period: h.period, value: h.value }))
				: [];
			return { period: raw.period, value: raw.value, history };
		}
		case 'log': {
			if (!Array.isArray(raw.entries)) return undefined;
			const entries: LogData['entries'] = [];
			for (const e of raw.entries) {
				if (!isEntry(e)) continue;
				const values = parseValues(block, e.values as Record<string, unknown>);
				if (values.ok) entries.push({ id: e.id, at: e.at, values: values.value });
			}
			return { entries: entries.sort((a, b) => b.at - a.at) };
		}
		case 'notes':
			return typeof raw.text === 'string' ? { text: raw.text.slice(0, LIMITS.notes) } : undefined;
	}
}

/** Reads saved data for `app`, keeping only what its current blocks can show. */
export function parseData(app: AppDefinition, raw: unknown): AppData {
	const data = emptyData();
	if (!isObject(raw) || raw.format !== FORMAT || !isObject(raw.blocks)) return data;
	for (const block of app.blocks) {
		const parsed = blockData(block, raw.blocks[block.id]);
		if (parsed) data.blocks[block.id] = parsed;
	}
	return data;
}
