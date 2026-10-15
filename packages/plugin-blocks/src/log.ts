/**
 * Log state: timestamped entries, newest first, and the numbers its chart and text summary show.
 */
import { addDays, dayKey } from './calendar.js';
import { ID, LIMITS, type LogBlock, type LogField, type Parsed } from './format.js';

/** A value for one field: a number (number, scale), a yes/no, an option id, text or `HH:MM`. */
export type LogValue = number | boolean | string;

export interface LogEntry {
	id: string;
	/** When it was logged, in ms. */
	at: number;
	values: Record<string, LogValue>;
}

export interface LogData {
	/** Newest first. */
	entries: LogEntry[];
}

/** The chart ranges, in days. */
export const RANGES = [7, 30, 90] as const;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Checks the values for a new or edited entry against the log's fields: unknown fields and
 * empty values are dropped, and an entry needs at least one value.
 */
export function parseValues(
	block: LogBlock,
	input: Record<string, unknown>
): Parsed<LogEntry['values']> {
	const values: LogEntry['values'] = {};
	for (const field of block.fields) {
		const raw = input[field.id];
		if (raw === undefined || raw === null || raw === '') continue;
		const parsed = value(field, raw);
		if (!parsed.ok) return parsed;
		values[field.id] = parsed.value;
	}
	if (Object.keys(values).length === 0) return { ok: false, error: 'Fill in at least one field.' };
	return { ok: true, value: values };
}

const ok = (value: LogValue): Parsed<LogValue> => ({ ok: true, value });
const error = (message: string): Parsed<LogValue> => ({ ok: false, error: message });

function value(field: LogField, raw: unknown): Parsed<LogValue> {
	switch (field.type) {
		case 'number': {
			if (typeof raw !== 'number' || !Number.isFinite(raw))
				return error(`${field.label} must be a number.`);
			if (field.min !== undefined && raw < field.min)
				return error(`${field.label} can't be below ${field.min}.`);
			if (field.max !== undefined && raw > field.max)
				return error(`${field.label} can't be above ${field.max}.`);
			return ok(raw);
		}
		case 'scale':
			return Number.isInteger(raw) && (raw as number) >= 1 && (raw as number) <= field.max
				? ok(raw as number)
				: error(`${field.label} must be from 1 to ${field.max}.`);
		case 'yesno':
			return typeof raw === 'boolean' ? ok(raw) : error(`${field.label} must be yes or no.`);
		case 'choice':
			return typeof raw === 'string' && field.options.some((o) => o.id === raw)
				? ok(raw)
				: error(`Choose one of the options for ${field.label}.`);
		case 'text':
			if (typeof raw !== 'string') return error(`${field.label} must be text.`);
			if (raw.length > LIMITS.text)
				return error(`${field.label} is longer than ${LIMITS.text} characters.`);
			return ok(raw);
		case 'time':
			return typeof raw === 'string' && TIME.test(raw)
				? ok(raw)
				: error(`${field.label} must be a time.`);
	}
}

/** Adds an entry, keeping the newest first. */
export function addEntry(data: LogData, entry: LogEntry): LogData {
	return { entries: sortEntries([entry, ...data.entries.filter((e) => e.id !== entry.id)]) };
}

/** Replaces the entry with `entry.id`. */
export function updateEntry(data: LogData, entry: LogEntry): LogData {
	return { entries: sortEntries(data.entries.map((e) => (e.id === entry.id ? entry : e))) };
}

/** Removes an entry; `addEntry` with the returned one puts it back (Undo). */
export function removeEntry(data: LogData, id: string): { data: LogData; removed?: LogEntry } {
	const removed = data.entries.find((e) => e.id === id);
	return { data: { entries: data.entries.filter((e) => e.id !== id) }, removed };
}

const sortEntries = (entries: LogEntry[]) => entries.sort((a, b) => b.at - a.at);

export interface Point {
	at: number;
	value: number;
}

/**
 * The points a number or scale field's chart shows over the last `days` local calendar days
 * (today included), oldest first.
 */
export function series(data: LogData, fieldId: string, days: number, now: Date | number): Point[] {
	const today = dayKey(now);
	const first = addDays(today, -(days - 1));
	const points: Point[] = [];
	for (const entry of data.entries) {
		const v = entry.values[fieldId];
		if (typeof v !== 'number') continue;
		const day = dayKey(entry.at);
		if (day < first || day > today) continue;
		points.push({ at: entry.at, value: v });
	}
	return points.sort((a, b) => a.at - b.at);
}

export interface Summary {
	latest: number;
	average: number;
	min: number;
	max: number;
	count: number;
}

/** Latest, average, lowest and highest of `points` (oldest first), or `null` with none. */
export function summarize(points: Point[]): Summary | null {
	const last = points.at(-1);
	if (!last) return null;
	const values = points.map((p) => p.value);
	const sum = values.reduce((a, b) => a + b, 0);
	return {
		latest: last.value,
		average: sum / values.length,
		min: Math.min(...values),
		max: Math.max(...values),
		count: values.length
	};
}

const format = (n: number) => String(Math.round(n * 10) / 10);

/** The chart's text summary, for screen readers and as the chart's caption. */
export function summaryText(field: LogField, s: Summary | null, days: number): string {
	if (!s) return `No ${field.label} in the last ${days} days.`;
	const unit = field.type === 'number' && field.unit ? ` ${field.unit}` : '';
	const entries = s.count === 1 ? '1 entry' : `${s.count} entries`;
	return (
		`${field.label}, last ${days} days: latest ${format(s.latest)}${unit}, ` +
		`average ${format(s.average)}${unit}, lowest ${format(s.min)}${unit}, ` +
		`highest ${format(s.max)}${unit} (${entries}).`
	);
}

/** Whether `value` looks like a saved entry; values are checked against the fields on load. */
export function isEntry(value: unknown): value is LogEntry {
	if (typeof value !== 'object' || value === null) return false;
	const e = value as Record<string, unknown>;
	return (
		typeof e.id === 'string' &&
		ID.test(e.id) &&
		typeof e.at === 'number' &&
		Number.isFinite(e.at) &&
		typeof e.values === 'object' &&
		e.values !== null &&
		!Array.isArray(e.values)
	);
}
