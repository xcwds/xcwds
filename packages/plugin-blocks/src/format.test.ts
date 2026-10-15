import { describe, expect, it } from 'vitest';
import { ID, LIMITS, newId, parseApp, type AppDefinition } from './format.js';
import { chores, fromTemplate, mood, templates, water } from './templates.js';

const app = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({
	format: 1,
	id: 'k3f9',
	name: 'Water',
	emoji: '💧',
	blocks,
	...extra
});

const error = (input: unknown) => {
	const r = parseApp(input);
	if (r.ok) throw new Error('expected an error');
	return r.error;
};

const ok = (input: unknown): AppDefinition => {
	const r = parseApp(input);
	if (!r.ok) throw new Error(r.error);
	return r.value;
};

describe('parseApp', () => {
	it("accepts the issue's example and every template", () => {
		const example = app([
			{ id: 'b1', type: 'counter', label: 'Glasses', goal: 8, reset: 'daily' },
			{
				id: 'b2',
				type: 'log',
				label: 'Notes',
				fields: [{ id: 'f1', type: 'text', label: 'Note' }]
			}
		]);
		expect(ok(example)).toEqual({ ...example, private: false });
		expect(ok(JSON.stringify(example)).blocks).toHaveLength(2);
		for (const t of templates) expect(ok(t)).toEqual(t);
	});

	it('returns a clean copy without unknown fields', () => {
		const parsed = ok(
			app([{ id: 'n', type: 'notes', label: ' Notes ', onclick: 'alert(1)' }], {
				script: 'x',
				private: 'yes'
			})
		);
		expect(parsed).toEqual({
			format: 1,
			id: 'k3f9',
			name: 'Water',
			emoji: '💧',
			private: false,
			blocks: [{ id: 'n', type: 'notes', label: 'Notes' }]
		});
	});

	it('keeps HTML-looking text as text', () => {
		const label = '<img src=x onerror=alert(1)> **bold** [link](https://x.test)';
		const parsed = ok(app([{ id: 'n', type: 'notes', label }], { name: '<b>Hi</b>' }));
		expect(parsed.name).toBe('<b>Hi</b>');
		expect(parsed.blocks[0]?.label).toBe(label);
	});

	it('rejects an unknown or newer format, and things that are not definitions', () => {
		expect(error(app([], { format: 2 }))).toMatch(/newer version/);
		expect(error(app([], { format: '1' }))).toMatch(/can read/);
		expect(error('not json')).toMatch(/isn't an app definition/);
		expect(error([])).toMatch(/isn't an app definition/);
		expect(error(null)).toMatch(/isn't an app definition/);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(error(cyclic)).toMatch(/isn't an app definition/);
	});

	it('rejects an unknown block or field type with a clear message', () => {
		expect(error(app([{ id: 'b', type: 'timer', label: 'T' }]))).toBe(
			`Block 1 has a type this version can't show "timer". Update the app and try again.`
		);
		expect(
			error(
				app([
					{ id: 'b', type: 'log', label: 'L', fields: [{ id: 'f', type: 'photo', label: 'P' }] }
				])
			)
		).toBe('Block 1, field 1 has an unknown type "photo".');
	});

	it('checks every limit', () => {
		const notes = (n: number) =>
			Array.from({ length: n }, (_, i) => ({ id: `b${i}`, type: 'notes', label: 'N' }));
		expect(ok(app(notes(LIMITS.blocks))).blocks).toHaveLength(20);
		expect(error(app(notes(LIMITS.blocks + 1)))).toMatch(/more than 20/);

		const fields = (n: number) =>
			Array.from({ length: n }, (_, i) => ({ id: `f${i}`, type: 'yesno', label: 'F' }));
		const log = (n: number) => app([{ id: 'l', type: 'log', label: 'L', fields: fields(n) }]);
		expect(ok(log(LIMITS.fields)).blocks).toHaveLength(1);
		expect(error(log(LIMITS.fields + 1))).toMatch(/more than 12/);
		expect(error(log(0))).toMatch(/at least 1/);

		const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, label: 'I' }));
		const list = (n: number) => app([{ id: 'c', type: 'checklist', label: 'C', items: items(n) }]);
		expect(ok(list(LIMITS.checklistItems)).blocks).toHaveLength(1);
		expect(error(list(LIMITS.checklistItems + 1))).toMatch(/more than 200/);

		const options = (n: number) =>
			Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: 'O' }));
		const choice = (n: number) =>
			app([
				{
					id: 'l',
					type: 'log',
					label: 'L',
					fields: [{ id: 'f', type: 'choice', label: 'C', options: options(n) }]
				}
			]);
		expect(ok(choice(LIMITS.choiceOptions)).blocks).toHaveLength(1);
		expect(error(choice(LIMITS.choiceOptions + 1))).toMatch(/more than 12/);
		expect(error(choice(0))).toMatch(/at least 1/);

		expect(error(app([], { name: 'x'.repeat(LIMITS.name + 1) }))).toMatch(/longer than 60/);
		expect(error(app([], { name: '  ' }))).toMatch(/can't be empty/);
		expect(error(app([{ id: 'n', type: 'notes', label: 'x'.repeat(LIMITS.label + 1) }]))).toMatch(
			/longer than 80/
		);
		const big = app([{ id: 'n', type: 'notes', label: 'N' }], {
			padding: 'x'.repeat(LIMITS.bytes)
		});
		expect(error(big)).toMatch(/larger than 32 KB/);
		expect(error(JSON.stringify(big))).toMatch(/larger than 32 KB/);
	});

	it('checks ids', () => {
		expect(error(app([], { id: 'a b' }))).toMatch(/invalid id/);
		expect(error(app([], { id: 'x'.repeat(33) }))).toMatch(/invalid id/);
		expect(
			error(
				app([
					{ id: 'b', type: 'notes', label: 'N' },
					{ id: 'b', type: 'notes', label: 'N' }
				])
			)
		).toMatch(/Block 2 has the same id/);
		expect(
			error(
				app([
					{
						id: 'c',
						type: 'checklist',
						label: 'C',
						items: [
							{ id: 'i', label: 'A' },
							{ id: 'i', label: 'B' }
						]
					}
				])
			)
		).toMatch(/item 2 has the same id/);
	});

	it('checks repeats, counters and fields', () => {
		const item = (repeat: unknown) =>
			app([{ id: 'c', type: 'checklist', label: 'C', items: [{ id: 'i', label: 'I', repeat }] }]);
		expect(ok(item({ repeat: 'weekly', weekdays: [5, 1] })).blocks[0]).toMatchObject({
			items: [{ repeat: { repeat: 'weekly', weekdays: [1, 5] } }]
		});
		expect(error(item({ repeat: 'weekly', weekdays: [] }))).toMatch(/at least 1/);
		expect(error(item({ repeat: 'weekly', weekdays: [1, 1] }))).toMatch(/twice/);
		expect(error(item({ repeat: 'weekly', weekdays: [7] }))).toMatch(/from 0 to 6/);
		expect(error(item({ repeat: 'every', days: 0 }))).toMatch(/from 1 to 365/);
		expect(error(item({ repeat: 'every', days: 1.5 }))).toMatch(/whole number/);
		expect(error(item({ repeat: 'every' }))).toMatch(/needs a number of days/);
		expect(error(item({ repeat: 'monthly' }))).toMatch(/unknown repeat/);

		const counter = (extra: Record<string, unknown>) =>
			app([{ id: 'c', type: 'counter', label: 'C', ...extra }]);
		expect(ok(counter({})).blocks[0]).toEqual({
			id: 'c',
			type: 'counter',
			label: 'C',
			reset: 'never'
		});
		expect(error(counter({ reset: 'hourly' }))).toMatch(/unknown reset/);
		expect(error(counter({ goal: 0 }))).toMatch(/from 1/);
		expect(error(counter({ goal: Infinity }))).toMatch(/must be a number/);

		const field = (f: Record<string, unknown>) =>
			app([{ id: 'l', type: 'log', label: 'L', fields: [{ id: 'f', label: 'F', ...f }] }]);
		expect(error(field({ type: 'scale', max: 7 }))).toMatch(/up to 5 or 10/);
		expect(error(field({ type: 'number', min: 5, max: 1 }))).toMatch(/minimum is above/);
		expect(ok(field({ type: 'number', unit: 'kg', min: 0 })).blocks[0]).toMatchObject({
			fields: [{ type: 'number', unit: 'kg', min: 0 }]
		});
	});
});

describe('newId and templates', () => {
	it('makes short random ids', () => {
		const ids = new Set(Array.from({ length: 100 }, newId));
		expect(ids.size).toBe(100);
		for (const id of ids) expect(id).toMatch(ID);
	});

	it('copies a template with a new id', () => {
		const copy = fromTemplate(water);
		expect(copy.id).not.toBe(water.id);
		expect({ ...copy, id: water.id }).toEqual(water);
		copy.blocks.length = 0;
		expect(water.blocks).toHaveLength(1);
		expect(fromTemplate(mood).private).toBe(true);
		expect(fromTemplate(chores).blocks[0]?.type).toBe('checklist');
	});
});
