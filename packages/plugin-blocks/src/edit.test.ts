import { describe, expect, it } from 'vitest';
import type { AppData } from './data.js';
import { blankApp, blankBlock, blankField, dataLoss, lossText, move, pruneData } from './edit.js';
import { parseApp, type AppDefinition, type LogBlock } from './format.js';

const health: AppDefinition = {
	format: 1,
	id: 'health',
	name: 'Health',
	private: false,
	blocks: [
		{
			id: 'log',
			type: 'log',
			label: 'Daily',
			fields: [
				{ id: 'weight', type: 'number', label: 'Weight', unit: 'kg' },
				{ id: 'mood', type: 'scale', label: 'Mood', max: 5 },
				{
					id: 'meal',
					type: 'choice',
					label: 'Meal',
					options: [
						{ id: 'b', label: 'Breakfast' },
						{ id: 'l', label: 'Lunch' }
					]
				}
			]
		},
		{ id: 'water', type: 'counter', label: 'Water', reset: 'daily' },
		{ id: 'notes', type: 'notes', label: 'Notes' },
		{ id: 'list', type: 'checklist', label: 'Pills', items: [{ id: 'am', label: 'Morning' }] }
	]
};

const data: AppData = {
	format: 1,
	blocks: {
		log: {
			entries: [
				{ id: 'e3', at: 3, values: { weight: 70, mood: 4, meal: 'l' } },
				{ id: 'e2', at: 2, values: { mood: 2 } },
				{ id: 'e1', at: 1, values: { weight: 71, meal: 'b' } }
			]
		},
		water: { period: '2026-10-17', value: 3, history: [] },
		notes: { text: 'Hello' },
		list: { done: { am: '2026-10-17' } }
	}
};

const log = (app: AppDefinition) => app.blocks[0] as LogBlock;
const withLog = (change: (block: LogBlock) => LogBlock): AppDefinition => ({
	...health,
	blocks: [change(log(health)), ...health.blocks.slice(1)]
});

describe('editing an app', () => {
	it('keeps everything when nothing that holds data changes, and when labels are renamed', () => {
		expect(dataLoss(health, health, data)).toEqual([]);
		const renamed = withLog((b) => ({
			...b,
			label: 'Every day',
			fields: b.fields.map((f) => ({ ...f, label: `${f.label}!` }))
		}));
		expect(dataLoss(health, renamed, data)).toEqual([]);
		expect(pruneData(health, renamed, data)).toEqual(data);
	});

	it('drops a removed block with data, and says so', () => {
		const after = { ...health, blocks: health.blocks.filter((b) => b.id !== 'water') };
		expect(dataLoss(health, after, data)).toEqual([{ kind: 'block', block: 'Water' }]);
		expect(pruneData(health, after, data).blocks.water).toBeUndefined();
		expect(lossText({ kind: 'block', block: 'Water' })).toBe('“Water” and everything saved in it.');
	});

	it('says nothing about a removed block that has no data', () => {
		const empty: AppData = { ...data, blocks: { ...data.blocks, notes: { text: ' ' } } };
		const after = { ...health, blocks: health.blocks.filter((b) => b.id !== 'notes') };
		expect(dataLoss(health, after, empty)).toEqual([]);
	});

	it('drops a removed log field from each entry, and entries left with nothing', () => {
		const after = withLog((b) => ({ ...b, fields: b.fields.filter((f) => f.id !== 'mood') }));
		expect(dataLoss(health, after, data)).toEqual([
			{ kind: 'field', block: 'Daily', field: 'Mood', count: 2 }
		]);
		expect(pruneData(health, after, data).blocks.log).toEqual({
			entries: [
				{ id: 'e3', at: 3, values: { weight: 70, meal: 'l' } },
				{ id: 'e1', at: 1, values: { weight: 71, meal: 'b' } }
			]
		});
	});

	it("drops a field's values when its type changes, even ones the new type would accept", () => {
		// 4 and 2 are valid numbers, but a rating isn't a weight.
		const after = withLog((b) => ({
			...b,
			fields: b.fields.map((f) =>
				f.id === 'mood' ? { id: 'mood', type: 'number', label: 'Mood' } : f
			)
		}));
		expect(dataLoss(health, after, data)).toEqual([
			{ kind: 'type', block: 'Daily', field: 'Mood', count: 2 }
		]);
		const entries = (pruneData(health, after, data).blocks.log as { entries: unknown[] }).entries;
		expect(entries).toEqual([
			{ id: 'e3', at: 3, values: { weight: 70, meal: 'l' } },
			{ id: 'e1', at: 1, values: { weight: 71, meal: 'b' } }
		]);
	});

	it('drops values that no longer fit a removed option or a narrower range', () => {
		const after = withLog((b) => ({
			...b,
			fields: b.fields.map((f) =>
				f.type === 'choice'
					? { ...f, options: f.options.filter((o) => o.id !== 'b') }
					: f.type === 'number'
						? { ...f, max: 70 }
						: f
			)
		}));
		expect(dataLoss(health, after, data)).toEqual([
			{ kind: 'values', block: 'Daily', field: 'Weight', count: 1 },
			{ kind: 'values', block: 'Daily', field: 'Meal', count: 1 }
		]);
		expect(lossText({ kind: 'values', block: 'Daily', field: 'Meal', count: 1 })).toBe(
			'1 value of “Meal” in “Daily” that no longer fit.'
		);
	});

	it('says when a counter that never reset starts resetting, which starts its count again', () => {
		const counter = (reset: 'never' | 'daily' | 'weekly'): AppDefinition => ({
			...health,
			blocks: health.blocks.map((b) => (b.type === 'counter' ? { ...b, reset } : b))
		});
		const total: AppData = {
			...data,
			blocks: { ...data.blocks, water: { period: 'all', value: 12, history: [] } }
		};
		expect(dataLoss(counter('never'), counter('weekly'), total)).toEqual([
			{ kind: 'count', block: 'Water', count: 12, reset: 'weekly' }
		]);
		expect(lossText({ kind: 'count', block: 'Water', count: 12, reset: 'daily' })).toBe(
			'The count of “Water” so far (12), because it now starts again each day.'
		);
		// From daily to weekly (or back) the count goes to the history, and nothing is lost.
		expect(dataLoss(counter('daily'), counter('weekly'), data)).toEqual([]);
		expect(
			dataLoss(counter('never'), counter('daily'), {
				...total,
				blocks: { ...total.blocks, water: { period: 'all', value: 0, history: [] } }
			})
		).toEqual([]);
	});

	it('treats a block turned into another type as removed', () => {
		const after: AppDefinition = {
			...health,
			blocks: health.blocks.map((b) =>
				b.id === 'notes' ? { id: 'notes', type: 'counter', label: 'Notes', reset: 'never' } : b
			)
		};
		expect(dataLoss(health, after, data)).toEqual([{ kind: 'block', block: 'Notes' }]);
		expect(pruneData(health, after, data).blocks.notes).toBeUndefined();
	});

	it('drops ticks of removed checklist items without asking', () => {
		const after: AppDefinition = {
			...health,
			blocks: health.blocks.map((b) => (b.type === 'checklist' ? { ...b, items: [] } : b))
		};
		expect(dataLoss(health, after, data)).toEqual([]);
		expect(pruneData(health, after, data).blocks.list).toEqual({ done: {} });
	});

	it('words field losses with counts', () => {
		expect(lossText({ kind: 'field', block: 'Daily', field: 'Mood', count: 1 })).toBe(
			'“Mood” in “Daily”, from 1 entry.'
		);
		expect(lossText({ kind: 'type', block: 'Daily', field: 'Mood', count: 3 })).toBe(
			'3 values of “Mood” in “Daily”, because its type changes.'
		);
	});
});

describe('the builder’s starting points', () => {
	it('starts an app with no name or blocks, and blocks and fields that are valid', () => {
		const app = blankApp();
		expect(app).toMatchObject({ format: 1, name: '', private: false, blocks: [] });
		expect(parseApp(app).ok).toBe(false);
		const blocks = (['checklist', 'counter', 'log', 'notes'] as const).map(blankBlock);
		const log = blocks[2] as LogBlock;
		log.fields = (['number', 'scale', 'choice', 'yesno', 'text', 'time'] as const).map(blankField);
		const parsed = parseApp({ ...app, name: 'Mine', blocks });
		expect(parsed.ok && parsed.value.blocks).toEqual(blocks);
		expect(new Set(blocks.map((b) => b.id)).size).toBe(4);
	});

	it('moves an item up or down, and leaves the list as it is at an end', () => {
		expect(move(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
		expect(move(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
		expect(move(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
		expect(move(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
	});
});
