/**
 * What the pages say about blocks, as plain text: how often an item repeats, a log value, when an
 * entry was logged. Kept out of the components so it can be tested in Node.
 */
import { daysBetween, type DayKey } from './calendar.js';
import type { ChecklistItem, LogField } from './format.js';
import type { LogValue, Point } from './log.js';

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

/** Where a chart's points go in an SVG `width` × `height`, with `pad` kept clear on each side. */
export interface ChartBox {
	width: number;
	height: number;
	pad: number;
}

/**
 * The y range a field's chart shows: a scale's own 1 to max; a number's min and max when it has
 * them, otherwise the values' own range (widened by one each way when they're all the same).
 */
export function chartRange(field: LogField, values: number[]): { low: number; high: number } {
	if (field.type === 'scale') return { low: 1, high: field.max };
	const low = field.type === 'number' && field.min !== undefined ? field.min : Math.min(...values);
	const high = field.type === 'number' && field.max !== undefined ? field.max : Math.max(...values);
	if (!Number.isFinite(low) || !Number.isFinite(high)) return { low: 0, high: 1 };
	return low === high ? { low: low - 1, high: high + 1 } : { low, high };
}

/**
 * The points of a chart over the last `days` local calendar days (today included), placed by
 * time from the start of the first day to the end of today.
 */
export function chartPoints(
	points: Point[],
	days: number,
	now: number,
	range: { low: number; high: number },
	box: ChartBox
): { x: number; y: number }[] {
	const today = new Date(now);
	const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
	const start = new Date(
		today.getFullYear(),
		today.getMonth(),
		today.getDate() - (days - 1)
	).getTime();
	const w = box.width - 2 * box.pad;
	const h = box.height - 2 * box.pad;
	const round = (n: number) => Math.round(n * 10) / 10;
	return points.map((p) => {
		const t = Math.min(1, Math.max(0, (p.at - start) / (end - start)));
		const v = Math.min(1, Math.max(0, (p.value - range.low) / (range.high - range.low)));
		return { x: round(box.pad + t * w), y: round(box.pad + (1 - v) * h) };
	});
}

/** What stands in for private apps while `@xcwds/plugin-vault` has them sealed (#265). */
export function lockedText(count: number): string {
	return `${count} private ${count === 1 ? 'app' : 'apps'}, locked`;
}

/** A size for people: "512 bytes", "4.2 KB", "1.5 MB" (1 KB = 1000, as phones count). */
export function sizeText(size: number): string {
	if (size < 1000) return `${size} ${size === 1 ? 'byte' : 'bytes'}`;
	const mb = size >= 999_500;
	const value = size / (mb ? 1_000_000 : 1000);
	const shown = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
	return `${shown} ${mb ? 'MB' : 'KB'}`;
}
