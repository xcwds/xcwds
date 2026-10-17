/**
 * What the pages say about blocks, as plain text: how often an item repeats, a log value, when an
 * entry was logged. Kept out of the components so it can be tested in Node.
 */
import { daysBetween, type DayKey } from './calendar.js';
import type { ChecklistItem, LogField } from './format.js';
import type { LogValue } from './log.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** How often a checklist item comes back: "Every day", "Mon, Thu", "Every 14 days", or "". */
export function repeatText(item: ChecklistItem): string {
	const r = item.repeat;
	if (!r) return '';
	switch (r.repeat) {
		case 'daily':
			return 'Every day';
		case 'every':
			return r.days === 1 ? 'Every day' : `Every ${r.days} days`;
		case 'weekly': {
			if (r.weekdays.length === 7) return 'Every day';
			// Monday first, as weeks run here.
			const days = [...r.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
			return days.map((d) => WEEKDAYS[d]).join(', ');
		}
	}
}

/** When a ticked repeating item is due again, relative to `today`: "Tomorrow", "In 3 days". */
export function dueText(due: DayKey, today: DayKey): string {
	const n = daysBetween(today, due);
	if (n <= 0) return 'Due today';
	return n === 1 ? 'Back tomorrow' : `Back in ${n} days`;
}

/** A logged value as text, with the field's unit or the option's label. */
export function valueText(field: LogField, value: LogValue): string {
	switch (field.type) {
		case 'number':
			return field.unit ? `${value} ${field.unit}` : String(value);
		case 'scale':
			return `${value} of ${field.max}`;
		case 'yesno':
			return value ? 'Yes' : 'No';
		case 'choice':
			return field.options.find((o) => o.id === value)?.label ?? '';
		case 'text':
		case 'time':
			return String(value);
	}
}

/** When an entry was logged: the time today, "Yesterday 08:15", or a date and time. */
export function whenText(at: number, now: number, locale?: string): string {
	const date = new Date(at);
	const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
	const today = new Date(now);
	const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((startOf(today) - startOf(date)) / 86_400_000);
	if (days === 0) return `Today ${time}`;
	if (days === 1) return `Yesterday ${time}`;
	const sameYear = date.getFullYear() === today.getFullYear();
	const day = date.toLocaleDateString(locale, {
		day: 'numeric',
		month: 'short',
		...(sameYear ? {} : { year: 'numeric' })
	});
	return `${day}, ${time}`;
}

/** A counter's past period as a label: "Mon 13 Oct" for a day, "Week of 13 Oct" for a week. */
export function periodText(period: string, weekly: boolean, locale?: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
	if (!m) return period;
	const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	const day = date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
	return weekly
		? `Week of ${day}`
		: `${date.toLocaleDateString(locale, { weekday: 'short' })} ${day}`;
}
