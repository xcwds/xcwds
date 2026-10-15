import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, dayKey, daysBetween, isDayKey, weekStart, weekday } from './calendar.js';
import { isTicked, nextDue, progress, tick, type ChecklistData } from './checklist.js';
import { adjust, current, emptyCounter, periodOf } from './counter.js';
import { emptyData, parseData } from './data.js';
import type { ChecklistBlock, CounterBlock, LogBlock } from './format.js';
import {
	addEntry,
	parseValues,
	removeEntry,
	series,
	summarize,
	summaryText,
	updateEntry,
	type LogData
} from './log.js';
import { mood } from './templates.js';

// A zone with DST, so days of 23 and 25 hours are covered.
const tz = process.env.TZ;
beforeAll(() => {
	process.env.TZ = 'America/Chicago';
});
afterAll(() => {
	process.env.TZ = tz;
});

const at = (s: string) => new Date(s).getTime();

describe('calendar', () => {
	it('uses the local calendar day', () => {
		expect(dayKey(at('2026-03-07T23:59:59'))).toBe('2026-03-07');
		expect(dayKey(at('2026-03-08T00:00:00'))).toBe('2026-03-08');
		// 03:30 UTC is still the evening before in Chicago.
		expect(dayKey(at('2026-10-15T03:30:00Z'))).toBe('2026-10-14');
	});

	it('counts days across DST changes', () => {
		expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
		expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
		expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
		expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
		expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
	});

	it('knows weekdays and week starts', () => {
		expect(weekday('2026-10-15')).toBe(4); // a Thursday
		expect(weekStart('2026-10-15')).toBe('2026-10-12');
		expect(weekStart('2026-10-12')).toBe('2026-10-12');
		expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday ends the week
	});

	it('checks day keys', () => {
		expect(isDayKey('2026-02-28')).toBe(true);
		expect(isDayKey('2026-02-30')).toBe(false);
		expect(isDayKey('2026-2-3')).toBe(false);
		expect(isDayKey(20260228)).toBe(false);
	});
});

describe('checklist', () => {
	const block: ChecklistBlock = {
		id: 'c',
		type: 'checklist',
		label: 'Chores',
		items: [
			{ id: 'once', label: 'Pack' },
			{ id: 'daily', label: 'Dishes', repeat: { repeat: 'daily' } },
			{ id: 'mon-thu', label: 'Bins', repeat: { repeat: 'weekly', weekdays: [1, 4] } },
			{ id: 'three', label: 'Plants', repeat: { repeat: 'every', days: 3 } }
		]
	};
	const [once, daily, monThu, three] = block.items as [
		ChecklistBlock['items'][number],
		ChecklistBlock['items'][number],
		ChecklistBlock['items'][number],
		ChecklistBlock['items'][number]
	];

	it('keeps a one-off item ticked until unticked', () => {
		let data: ChecklistData = { done: {} };
		data = tick(data, once, true, '2026-10-15');
		expect(nextDue(once, '2026-10-15')).toBeNull();
		expect(isTicked(once, data, '2027-01-01')).toBe(true);
		data = tick(data, once, false, '2027-01-01');
		expect(isTicked(once, data, '2027-01-01')).toBe(false);
	});

	it('unticks a daily item at local midnight, DST nights included', () => {
		const data = tick({ done: {} }, daily, true, dayKey(at('2026-03-07T23:59:00')));
		expect(isTicked(daily, data, dayKey(at('2026-03-07T23:59:59')))).toBe(true);
		expect(isTicked(daily, data, dayKey(at('2026-03-08T00:00:01')))).toBe(false);
		const fall = tick({ done: {} }, daily, true, dayKey(at('2026-11-01T00:30:00')));
		// 25-hour day: still ticked at 23:30 on the same date.
		expect(isTicked(daily, fall, dayKey(at('2026-11-01T23:30:00')))).toBe(true);
		expect(isTicked(daily, fall, dayKey(at('2026-11-02T00:00:00')))).toBe(false);
	});

	it('unticks a weekly item on its next chosen weekday', () => {
		// Ticked Monday 12th: next due Thursday 15th.
		expect(nextDue(monThu, '2026-10-12')).toBe('2026-10-15');
		// Ticked Thursday 15th: next due Monday 19th.
		expect(nextDue(monThu, '2026-10-15')).toBe('2026-10-19');
		// Ticked on a day not chosen (Saturday): due on the next chosen one.
		expect(nextDue(monThu, '2026-10-17')).toBe('2026-10-19');
		const data = tick({ done: {} }, monThu, true, '2026-10-12');
		expect(isTicked(monThu, data, '2026-10-14')).toBe(true);
		expect(isTicked(monThu, data, '2026-10-15')).toBe(false);
	});

	it('unticks an every-N-days item N days later', () => {
		const data = tick({ done: {} }, three, true, '2026-03-07');
		expect(isTicked(three, data, '2026-03-09')).toBe(true);
		expect(isTicked(three, data, '2026-03-10')).toBe(false);
	});

	it('counts progress for today', () => {
		let data: ChecklistData = { done: {} };
		data = tick(data, once, true, '2026-10-14');
		data = tick(data, daily, true, '2026-10-14');
		data = tick(data, three, true, '2026-10-14');
		expect(progress(block, data, '2026-10-15')).toEqual({ done: 2, total: 4 });
	});
});

describe('counter', () => {
	const daily: CounterBlock = { id: 'w', type: 'counter', label: 'Water', reset: 'daily', goal: 8 };
	const weekly: CounterBlock = { ...daily, reset: 'weekly' };
	const never: CounterBlock = { ...daily, reset: 'never' };

	it('resets by local calendar day and keeps past days', () => {
		const night = at('2026-03-07T23:30:00');
		let data = emptyCounter(daily, night);
		data = adjust(daily, data, 1, night);
		data = adjust(daily, data, 1, night);
		expect(data).toMatchObject({ period: '2026-03-07', value: 2 });
		// DST starts at 2am on the 8th: the reset is still at local midnight.
		const after = at('2026-03-08T00:10:00');
		expect(current(daily, data, after)).toEqual({
			period: '2026-03-08',
			value: 0,
			history: [{ period: '2026-03-07', value: 2 }]
		});
		data = adjust(daily, data, 1, after);
		expect(data.value).toBe(1);
		expect(data.history).toEqual([{ period: '2026-03-07', value: 2 }]);
	});

	it('skips empty days in the history and never goes below zero', () => {
		let data = emptyCounter(daily, at('2026-10-14T12:00:00'));
		data = adjust(daily, data, -1, at('2026-10-14T12:00:00'));
		expect(data.value).toBe(0);
		data = adjust(daily, data, 0.6, at('2026-10-14T12:00:00'));
		expect(data.value).toBe(1);
		data = adjust(daily, data, -1, at('2026-10-14T12:00:00'));
		data = current(daily, data, at('2026-10-15T12:00:00'));
		expect(data.history).toEqual([]);
	});

	it('resets weekly on Monday', () => {
		expect(periodOf('weekly', at('2026-10-18T23:59:00'))).toBe('2026-10-12');
		expect(periodOf('weekly', at('2026-10-19T00:00:00'))).toBe('2026-10-19');
		let data = adjust(
			weekly,
			emptyCounter(weekly, at('2026-10-13T09:00:00')),
			3,
			at('2026-10-13T09:00:00')
		);
		data = current(weekly, data, at('2026-10-20T09:00:00'));
		expect(data).toEqual({
			period: '2026-10-19',
			value: 0,
			history: [{ period: '2026-10-12', value: 3 }]
		});
	});

	it('never resets a counter that never resets, even after its setting changed', () => {
		let data = adjust(
			daily,
			emptyCounter(daily, at('2026-10-14T09:00:00')),
			5,
			at('2026-10-14T09:00:00')
		);
		data = current(never, data, at('2026-10-20T09:00:00'));
		expect(data).toEqual({ period: 'all', value: 5, history: [] });
		data = adjust(never, data, 1, at('2027-10-20T09:00:00'));
		expect(data.value).toBe(6);
	});
});

describe('log', () => {
	const block = mood.blocks[0] as LogBlock;

	it('checks values against the fields', () => {
		expect(parseValues(block, { mood: 4, slept: 7.5, note: '!important', extra: 1 })).toEqual({
			ok: true,
			value: { mood: 4, slept: 7.5, note: '!important' }
		});
		expect(parseValues(block, { mood: 6 })).toEqual({
			ok: false,
			error: 'Mood must be from 1 to 5.'
		});
		expect(parseValues(block, { mood: 2.5 })).toMatchObject({ ok: false });
		expect(parseValues(block, { slept: 25 })).toEqual({
			ok: false,
			error: "Sleep can't be above 24."
		});
		expect(parseValues(block, { slept: -1 })).toEqual({
			ok: false,
			error: "Sleep can't be below 0."
		});
		expect(parseValues(block, { note: 'x'.repeat(501) })).toMatchObject({ ok: false });
		expect(parseValues(block, { note: '' })).toEqual({
			ok: false,
			error: 'Fill in at least one field.'
		});

		const other: LogBlock = {
			id: 'o',
			type: 'log',
			label: 'O',
			fields: [
				{ id: 'y', type: 'yesno', label: 'Taken' },
				{ id: 'c', type: 'choice', label: 'Where', options: [{ id: 'h', label: 'Home' }] },
				{ id: 't', type: 'time', label: 'At' }
			]
		};
		expect(parseValues(other, { y: false, c: 'h', t: '23:59' })).toMatchObject({ ok: true });
		expect(parseValues(other, { y: 'no' })).toMatchObject({ ok: false });
		expect(parseValues(other, { c: 'Home' })).toMatchObject({ ok: false });
		expect(parseValues(other, { t: '24:00' })).toMatchObject({ ok: false });
	});

	it('keeps entries newest first, editable and removable with Undo', () => {
		let data: LogData = { entries: [] };
		data = addEntry(data, { id: 'a', at: 1, values: { mood: 1 } });
		data = addEntry(data, { id: 'c', at: 3, values: { mood: 3 } });
		data = addEntry(data, { id: 'b', at: 2, values: { mood: 2 } });
		expect(data.entries.map((e) => e.id)).toEqual(['c', 'b', 'a']);
		data = updateEntry(data, { id: 'a', at: 4, values: { mood: 5 } });
		expect(data.entries.map((e) => e.id)).toEqual(['a', 'c', 'b']);
		const { data: without, removed } = removeEntry(data, 'c');
		expect(without.entries.map((e) => e.id)).toEqual(['a', 'b']);
		expect(addEntry(without, removed!)).toEqual(data);
	});

	it('charts a range of local days and summarises it', () => {
		const now = at('2026-10-15T08:00:00');
		const data: LogData = {
			entries: [
				{ id: 'a', at: at('2026-10-15T07:00:00'), values: { mood: 4 } },
				{ id: 'b', at: at('2026-10-09T00:00:00'), values: { mood: 2 } },
				{ id: 'c', at: at('2026-10-08T23:59:00'), values: { mood: 5 } },
				{ id: 'd', at: at('2026-10-12T12:00:00'), values: { note: 'no mood' } },
				{ id: 'e', at: at('2026-07-01T12:00:00'), values: { mood: 1 } }
			]
		};
		const week = series(data, 'mood', 7, now);
		expect(week.map((p) => p.value)).toEqual([2, 4]);
		expect(series(data, 'mood', 30, now).map((p) => p.value)).toEqual([5, 2, 4]);
		expect(series(data, 'mood', 90, now)).toHaveLength(3);
		const field = block.fields[0]!;
		const s = summarize(week);
		expect(s).toEqual({ latest: 4, average: 3, min: 2, max: 4, count: 2 });
		expect(summaryText(field, s, 7)).toBe(
			'Mood, last 7 days: latest 4, average 3, lowest 2, highest 4 (2 entries).'
		);
		expect(summaryText(block.fields[1]!, summarize([{ at: 1, value: 7.25 }]), 30)).toBe(
			'Sleep, last 30 days: latest 7.3 h, average 7.3 h, lowest 7.3 h, highest 7.3 h (1 entry).'
		);
		expect(summaryText(field, summarize([]), 90)).toBe('No Mood in the last 90 days.');
	});
});

describe('parseData', () => {
	it('keeps only what the current definition can show', () => {
		const raw = {
			format: 1,
			blocks: {
				log: {
					entries: [
						{ id: 'a', at: 2, values: { mood: 3, gone: 1 } },
						{ id: 'b', at: 1, values: { mood: 9 } },
						{ id: 'c', at: 4, values: { mood: 9, slept: 8 } },
						{ id: 'bad id', at: 3, values: { mood: 1 } },
						'junk'
					]
				},
				notes: { text: 'hello <b>there</b>' },
				removed: { text: 'x' }
			}
		};
		expect(parseData(mood, raw)).toEqual({
			format: 1,
			blocks: {
				log: {
					entries: [
						{ id: 'c', at: 4, values: { slept: 8 } },
						{ id: 'a', at: 2, values: { mood: 3 } }
					]
				},
				notes: { text: 'hello <b>there</b>' }
			}
		});
		expect(parseData(mood, { format: 2, blocks: {} })).toEqual(emptyData());
		expect(parseData(mood, 'junk')).toEqual(emptyData());
	});

	it('reads checklists and counters', () => {
		const app = {
			format: 1 as const,
			id: 'a',
			name: 'A',
			private: false,
			blocks: [
				{ id: 'c', type: 'checklist' as const, label: 'C', items: [{ id: 'i', label: 'I' }] },
				{ id: 'n', type: 'counter' as const, label: 'N', reset: 'daily' as const }
			]
		};
		expect(
			parseData(app, {
				format: 1,
				blocks: {
					c: { done: { i: '2026-10-15', gone: '2026-10-15' } },
					n: {
						period: '2026-10-15',
						value: 2,
						history: [
							{ period: '2026-10-14', value: 1 },
							{ period: 'x', value: 1 }
						]
					}
				}
			}).blocks
		).toEqual({
			c: { done: { i: '2026-10-15' } },
			n: { period: '2026-10-15', value: 2, history: [{ period: '2026-10-14', value: 1 }] }
		});
		expect(
			parseData(app, { format: 1, blocks: { n: { period: 'today', value: -1 } } }).blocks
		).toEqual({});
	});
});
