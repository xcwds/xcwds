/**
 * Checklist state: when each item was last ticked. A one-off item stays ticked until it's
 * unticked; a repeating one unticks itself on the day it's due again.
 */
import { addDays, daysBetween, weekday, type DayKey } from './calendar.js';
import type { ChecklistBlock, ChecklistItem } from './format.js';

/** The day each ticked item was ticked, by item id. */
export interface ChecklistData {
	done: Record<string, DayKey>;
}

/** The first day after `done` on which `item` is due again, or `null` for a one-off item. */
export function nextDue(item: ChecklistItem, done: DayKey): DayKey | null {
	const r = item.repeat;
	if (!r) return null;
	switch (r.repeat) {
		case 'daily':
			return addDays(done, 1);
		case 'every':
			return addDays(done, r.days);
		case 'weekly': {
			for (let n = 1; n <= 7; n++) {
				const day = addDays(done, n);
				if (r.weekdays.includes(weekday(day))) return day;
			}
			return addDays(done, 7);
		}
	}
}

/** Whether `item` shows as ticked on `today`. */
export function isTicked(item: ChecklistItem, data: ChecklistData, today: DayKey): boolean {
	const done = data.done[item.id];
	if (done === undefined) return false;
	const due = nextDue(item, done);
	return due === null || daysBetween(today, due) > 0;
}

/** Ticks or unticks `item` on `today`, returning new data. */
export function tick(
	data: ChecklistData,
	item: ChecklistItem,
	ticked: boolean,
	today: DayKey
): ChecklistData {
	const done = { ...data.done };
	if (ticked) done[item.id] = today;
	else delete done[item.id];
	return { done };
}

/** Counts the items ticked on `today`, for a "3 of 5" line. */
export function progress(
	block: ChecklistBlock,
	data: ChecklistData,
	today: DayKey
): { done: number; total: number } {
	const done = block.items.filter((item) => isTicked(item, data, today)).length;
	return { done, total: block.items.length };
}
