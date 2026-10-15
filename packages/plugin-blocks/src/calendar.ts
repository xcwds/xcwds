/**
 * Local calendar days. Apps made of blocks count "today" by the wall clock's local calendar day,
 * saved as a `YYYY-MM-DD` key, so a day is a day whatever the time zone offset or a DST change
 * does to its length. Day arithmetic runs on the key in UTC, where every day is 24 hours.
 */

/** A local calendar day, `YYYY-MM-DD`. */
export type DayKey = string;

const DAY_MS = 86_400_000;
const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The local calendar day of `date` (a `Date` or a timestamp in ms). */
export function dayKey(date: Date | number): DayKey {
	const d = typeof date === 'number' ? new Date(date) : date;
	return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whether `value` is a real calendar day key (`2026-02-30` isn't). */
export function isDayKey(value: unknown): value is DayKey {
	if (typeof value !== 'string') return false;
	const m = KEY.exec(value);
	if (!m) return false;
	return utcKey(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) === value;
}

function toUtc(key: DayKey): number {
	const m = KEY.exec(key);
	if (!m) throw new Error(`Not a day: ${key}`);
	return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function utcKey(ms: number): DayKey {
	const d = new Date(ms);
	return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The day `n` days after `key` (before it when `n` is negative). */
export function addDays(key: DayKey, n: number): DayKey {
	return utcKey(toUtc(key) + n * DAY_MS);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: DayKey, to: DayKey): number {
	return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** The day of the week, 0 = Sunday to 6 = Saturday, as `Date.getDay()` counts them. */
export function weekday(key: DayKey): number {
	return new Date(toUtc(key)).getUTCDay();
}

/** The Monday that starts `key`'s week (weeks run Monday to Sunday). */
export function weekStart(key: DayKey): DayKey {
	return addDays(key, -((weekday(key) + 6) % 7));
}
