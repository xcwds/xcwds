import { describe, expect, it } from 'vitest';
import type { LogField } from './format.js';
import { dueText, periodText, repeatText, valueText, whenText } from './view.js';

describe('repeatText', () => {
	it('says how often an item comes back, weeks starting on Monday', () => {
		expect(repeatText({ id: 'a', label: 'A' })).toBe('');
		expect(repeatText({ id: 'a', label: 'A', repeat: { repeat: 'daily' } })).toBe('Every day');
		expect(repeatText({ id: 'a', label: 'A', repeat: { repeat: 'every', days: 14 } })).toBe(
			'Every 14 days'
		);
		expect(repeatText({ id: 'a', label: 'A', repeat: { repeat: 'every', days: 1 } })).toBe(
			'Every day'
		);
		expect(
			repeatText({ id: 'a', label: 'A', repeat: { repeat: 'weekly', weekdays: [0, 4, 1] } })
		).toBe('Mon, Thu, Sun');
		expect(
			repeatText({
				id: 'a',
				label: 'A',
				repeat: { repeat: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] }
			})
		).toBe('Every day');
	});
});

it('dueText counts the days until an item is back', () => {
	expect(dueText('2026-10-18', '2026-10-17')).toBe('Back tomorrow');
	expect(dueText('2026-10-31', '2026-10-17')).toBe('Back in 14 days');
	expect(dueText('2026-10-17', '2026-10-17')).toBe('Due today');
});

it('valueText shows units, scales, yes or no and option labels', () => {
	const fields: Record<string, LogField> = {
		n: { id: 'n', type: 'number', label: 'Sleep', unit: 'h' },
		bare: { id: 'bare', type: 'number', label: 'Steps' },
		s: { id: 's', type: 'scale', label: 'Mood', max: 5 },
		y: { id: 'y', type: 'yesno', label: 'Took it' },
		c: { id: 'c', type: 'choice', label: 'Where', options: [{ id: 'h', label: 'Home' }] },
		t: { id: 't', type: 'text', label: 'Note' }
	};
	expect(valueText(fields.n!, 7.5)).toBe('7.5 h');
	expect(valueText(fields.bare!, 9000)).toBe('9000');
	expect(valueText(fields.s!, 4)).toBe('4 of 5');
	expect(valueText(fields.y!, false)).toBe('No');
	expect(valueText(fields.c!, 'h')).toBe('Home');
	expect(valueText(fields.c!, 'gone')).toBe('');
	expect(valueText(fields.t!, '<b>hi</b>')).toBe('<b>hi</b>');
});

it('whenText says today, yesterday or the date', () => {
	const now = new Date(2026, 9, 17, 12, 0).getTime();
	expect(whenText(new Date(2026, 9, 17, 8, 5).getTime(), now, 'en-GB')).toBe('Today 08:05');
	expect(whenText(new Date(2026, 9, 16, 23, 30).getTime(), now, 'en-GB')).toBe('Yesterday 23:30');
	expect(whenText(new Date(2026, 9, 3, 9, 0).getTime(), now, 'en-GB')).toBe('3 Oct, 09:00');
	expect(whenText(new Date(2025, 11, 30, 9, 0).getTime(), now, 'en-GB')).toBe('30 Dec 2025, 09:00');
});

it('periodText names a past day or week', () => {
	expect(periodText('2026-10-13', false, 'en-GB')).toBe('Tue 13 Oct');
	expect(periodText('2026-10-12', true, 'en-GB')).toBe('Week of 12 Oct');
	expect(periodText('all', false)).toBe('all');
});
