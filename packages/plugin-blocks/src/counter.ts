/**
 * Counter state: the current count and, for counters that reset, the totals of past days or
 * weeks. A counter rolls over lazily: the first read or change in a new period files the old
 * count in its history.
 */
import { dayKey, weekStart, type DayKey } from './calendar.js';
import type { CounterBlock, CounterReset } from './format.js';

/** How many past periods a counter keeps: a year of days, or ten years of weeks. */
export const HISTORY = 520;

export interface CounterData {
	/** The period `value` counts: a day, the Monday of a week, or `all`. */
	period: string;
	value: number;
	/** Past periods with a count, newest first. */
	history: { period: string; value: number }[];
}

/** The period `now` falls in for a counter that resets `reset`. */
export function periodOf(reset: CounterReset, now: Date | number): string {
	if (reset === 'never') return 'all';
	const day: DayKey = dayKey(now);
	return reset === 'daily' ? day : weekStart(day);
}

export const emptyCounter = (block: CounterBlock, now: Date | number): CounterData => ({
	period: periodOf(block.reset, now),
	value: 0,
	history: []
});

/** The counter as of `now`: last period's count moves to the history once a new one starts. */
export function current(block: CounterBlock, data: CounterData, now: Date | number): CounterData {
	const period = periodOf(block.reset, now);
	if (data.period === period) return data;
	// A counter that stopped resetting keeps counting from where it was.
	if (period === 'all') return { ...data, period };
	const history =
		data.value !== 0 && data.period !== 'all'
			? [{ period: data.period, value: data.value }, ...data.history].slice(0, HISTORY)
			: data.history;
	return { period, value: 0, history };
}

/** Adds `delta` (+1 or −1 from the buttons) as of `now`; a count never goes below zero. */
export function adjust(
	block: CounterBlock,
	data: CounterData,
	delta: number,
	now: Date | number
): CounterData {
	const c = current(block, data, now);
	return { ...c, value: Math.max(0, c.value + delta) };
}
