/** What the builder's forms share. */
import type { Block, LogField } from '../format.js';

/** The block types, with a line on what each is for. */
export const BLOCK_TYPES: readonly [Block['type'], string, string][] = [
	['checklist', 'Checklist', 'Items to tick off, once or on a schedule.'],
	['counter', 'Counter', 'A number with − and +, with a goal if you like.'],
	['log', 'Log', 'Entries with a time, like mood, weight or symptoms.'],
	['notes', 'Notes', 'One place to write things down.']
];

export const FIELD_TYPES: readonly [LogField['type'], string][] = [
	['number', 'Number'],
	['scale', 'Rating (1 to 5 or 10)'],
	['yesno', 'Yes or no'],
	['choice', 'Choice'],
	['text', 'Text'],
	['time', 'Time of day']
];

/**
 * Sets an optional number from a number input's text: empty removes it, so the definition says
 * "none" rather than holding a blank that `parseApp` would refuse.
 */
export function setNumber(target: object, key: string, text: string): void {
	const record = target as Record<string, unknown>;
	if (text.trim() === '') delete record[key];
	else record[key] = Number(text);
}
