/**
 * The definition format of an app made of blocks (#160): plain JSON listing building blocks,
 * which the plugin renders with its own components (RFC 0001, decision 14). `parseApp` is the only
 * way a definition gets in, from a template, the builder (#161) or a shared file (#162): it
 * checks every limit, rejects an unknown `format` or block type with a message a person can read,
 * and returns a clean copy holding only the fields it knows. All text stays text: nothing in a
 * definition is ever rendered as HTML, Markdown or a link.
 */

/** The format this version writes and reads. A later format adds a migration. */
export const FORMAT = 1;

export const LIMITS = {
	/** A definition's size as UTF-8 JSON. */
	bytes: 32 * 1024,
	blocks: 20,
	fields: 12,
	checklistItems: 200,
	choiceOptions: 12,
	name: 60,
	label: 80,
	unit: 20,
	emoji: 16,
	/** Characters in a log's text field and in a notes block. */
	text: 500,
	notes: 20_000,
	everyDays: 365,
	goal: 1_000_000
} as const;

/** Ids are short strings of letters, digits, `-` and `_`; `newId()` makes random ones. */
export const ID = /^[A-Za-z0-9_-]{1,32}$/;

export type Repeat =
	| { repeat: 'daily' }
	| { repeat: 'weekly'; weekdays: number[] }
	| { repeat: 'every'; days: number };

export interface ChecklistItem {
	id: string;
	label: string;
	/** Absent for a one-off item, which stays ticked until unticked. */
	repeat?: Repeat;
}

export interface ChecklistBlock {
	id: string;
	type: 'checklist';
	label: string;
	items: ChecklistItem[];
}

export type CounterReset = 'never' | 'daily' | 'weekly';

export interface CounterBlock {
	id: string;
	type: 'counter';
	label: string;
	goal?: number;
	unit?: string;
	reset: CounterReset;
}

export interface NumberField {
	id: string;
	type: 'number';
	label: string;
	unit?: string;
	min?: number;
	max?: number;
}

export interface ScaleField {
	id: string;
	type: 'scale';
	label: string;
	/** The top of the scale; it starts at 1. */
	max: 5 | 10;
	/** Words for the ends of the scale. */
	low?: string;
	high?: string;
}

export interface ChoiceField {
	id: string;
	type: 'choice';
	label: string;
	options: { id: string; label: string }[];
}

export interface PlainField {
	id: string;
	type: 'yesno' | 'text' | 'time';
	label: string;
}

export type LogField = NumberField | ScaleField | ChoiceField | PlainField;

export interface LogBlock {
	id: string;
	type: 'log';
	label: string;
	fields: LogField[];
}

export interface NotesBlock {
	id: string;
	type: 'notes';
	label: string;
}

export type Block = ChecklistBlock | CounterBlock | LogBlock | NotesBlock;

export interface AppDefinition {
	format: typeof FORMAT;
	id: string;
	name: string;
	emoji?: string;
	private: boolean;
	blocks: Block[];
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** A random id for an app, block, item, field or entry. */
export function newId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(9));
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replaceAll('+', '-').replaceAll('/', '_');
}

class Invalid extends Error {}

const fail = (message: string): never => {
	throw new Invalid(message);
};

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

function text(value: unknown, what: string, max: number, required = true): string | undefined {
	if (value === undefined && !required) return undefined;
	if (typeof value !== 'string') return fail(`${what} must be text.`);
	const trimmed = value.trim();
	if (!trimmed) {
		if (!required) return undefined;
		fail(`${what} can't be empty.`);
	}
	if (trimmed.length > max) fail(`${what} is longer than ${max} characters.`);
	return trimmed;
}

function id(value: unknown, what: string, seen?: Set<string>): string {
	if (typeof value !== 'string' || !ID.test(value)) fail(`${what} has a missing or invalid id.`);
	const v = value as string;
	if (seen) {
		if (seen.has(v)) fail(`${what} has the same id as another one.`);
		seen.add(v);
	}
	return v;
}

function number(
	value: unknown,
	what: string,
	{ integer = false, min = -Infinity, max = Infinity } = {}
): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${what} must be a number.`);
	const n = value as number;
	if (integer && !Number.isInteger(n)) fail(`${what} must be a whole number.`);
	if (n < min || n > max) fail(`${what} must be from ${min} to ${max}.`);
	return n;
}

function list(value: unknown, what: string, max: number, min = 0): unknown[] {
	if (!Array.isArray(value)) return fail(`${what} must be a list.`);
	if (value.length < min) fail(`${what} needs at least ${min}.`);
	if (value.length > max) fail(`${what} has more than ${max}.`);
	return value;
}

function repeat(value: unknown, what: string): Repeat | undefined {
	if (value === undefined) return undefined;
	if (!isObject(value)) return fail(`${what} has an invalid repeat.`);
	switch (value.repeat) {
		case 'daily':
			return { repeat: 'daily' };
		case 'weekly': {
			const days = list(value.weekdays, `${what}'s weekdays`, 7, 1).map((d) =>
				number(d, `${what}'s weekdays`, { integer: true, min: 0, max: 6 })
			) as number[];
			if (new Set(days).size !== days.length) fail(`${what} lists a weekday twice.`);
			return { repeat: 'weekly', weekdays: days.sort((a, b) => a - b) };
		}
		case 'every': {
			const days = number(value.days, `${what}'s days`, {
				integer: true,
				min: 1,
				max: LIMITS.everyDays
			});
			if (days === undefined) fail(`${what} needs a number of days.`);
			return { repeat: 'every', days: days as number };
		}
		default:
			return fail(`${what} has an unknown repeat.`);
	}
}

function field(value: unknown, what: string, ids: Set<string>): LogField {
	if (!isObject(value)) return fail(`${what} is invalid.`);
	const base = {
		id: id(value.id, what, ids),
		label: text(value.label, `${what}'s label`, LIMITS.label) as string
	};
	switch (value.type) {
		case 'number': {
			const f: NumberField = { ...base, type: 'number' };
			const unit = text(value.unit, `${what}'s unit`, LIMITS.unit, false);
			const min = number(value.min, `${what}'s minimum`);
			const max = number(value.max, `${what}'s maximum`);
			if (min !== undefined && max !== undefined && min > max)
				fail(`${what}'s minimum is above its maximum.`);
			if (unit !== undefined) f.unit = unit;
			if (min !== undefined) f.min = min;
			if (max !== undefined) f.max = max;
			return f;
		}
		case 'scale': {
			if (value.max !== 5 && value.max !== 10) fail(`${what} must go up to 5 or 10.`);
			const f: ScaleField = { ...base, type: 'scale', max: value.max as 5 | 10 };
			const low = text(value.low, `${what}'s low end`, LIMITS.label, false);
			const high = text(value.high, `${what}'s high end`, LIMITS.label, false);
			if (low !== undefined) f.low = low;
			if (high !== undefined) f.high = high;
			return f;
		}
		case 'choice': {
			const optionIds = new Set<string>();
			const options = list(value.options, `${what}'s options`, LIMITS.choiceOptions, 1).map(
				(o, i) => {
					const where = `${what}, option ${i + 1}`;
					if (!isObject(o)) return fail(`${where} is invalid.`);
					return {
						id: id(o.id, where, optionIds),
						label: text(o.label, where, LIMITS.label) as string
					};
				}
			);
			return { ...base, type: 'choice', options };
		}
		case 'yesno':
		case 'text':
		case 'time':
			return { ...base, type: value.type };
		default:
			return fail(`${what} has an unknown type${typeName(value.type)}.`);
	}
}

const typeName = (type: unknown) =>
	typeof type === 'string' ? ` "${type.slice(0, LIMITS.label)}"` : '';

function block(value: unknown, n: number, ids: Set<string>): Block {
	const what = `Block ${n}`;
	if (!isObject(value)) return fail(`${what} is invalid.`);
	const base = {
		id: id(value.id, what, ids),
		label: text(value.label, `${what}'s label`, LIMITS.label) as string
	};
	switch (value.type) {
		case 'checklist': {
			const itemIds = new Set<string>();
			const items = list(value.items, `${what}'s items`, LIMITS.checklistItems).map((v, i) => {
				const where = `${what}, item ${i + 1}`;
				if (!isObject(v)) return fail(`${where} is invalid.`);
				const item: ChecklistItem = {
					id: id(v.id, where, itemIds),
					label: text(v.label, `${where}'s label`, LIMITS.label) as string
				};
				const r = repeat(v.repeat, where);
				if (r) item.repeat = r;
				return item;
			});
			return { ...base, type: 'checklist', items };
		}
		case 'counter': {
			const reset = value.reset ?? 'never';
			if (reset !== 'never' && reset !== 'daily' && reset !== 'weekly')
				fail(`${what} has an unknown reset.`);
			const b: CounterBlock = { ...base, type: 'counter', reset: reset as CounterReset };
			const goal = number(value.goal, `${what}'s goal`, {
				integer: true,
				min: 1,
				max: LIMITS.goal
			});
			const unit = text(value.unit, `${what}'s unit`, LIMITS.unit, false);
			if (goal !== undefined) b.goal = goal;
			if (unit !== undefined) b.unit = unit;
			return b;
		}
		case 'log': {
			const fieldIds = new Set<string>();
			const fields = list(value.fields, `${what}'s fields`, LIMITS.fields, 1).map((f, i) =>
				field(f, `${what}, field ${i + 1}`, fieldIds)
			);
			return { ...base, type: 'log', fields };
		}
		case 'notes':
			return { ...base, type: 'notes' };
		default:
			return fail(
				`${what} has a type this version can't show${typeName(value.type)}. Update the app and try again.`
			);
	}
}

/**
 * Checks a definition (already parsed from JSON, or a JSON string) and returns a clean copy, or
 * the first problem as a sentence.
 */
export function parseApp(input: unknown): Parsed<AppDefinition> {
	try {
		let value = input;
		if (typeof value === 'string') {
			if (byteLength(value) > LIMITS.bytes) fail(tooBig());
			try {
				value = JSON.parse(value);
			} catch {
				fail("This isn't an app definition.");
			}
		} else {
			let json: string | undefined;
			try {
				json = JSON.stringify(value);
			} catch {
				fail("This isn't an app definition.");
			}
			if (byteLength(json ?? '') > LIMITS.bytes) fail(tooBig());
		}
		if (!isObject(value)) return fail("This isn't an app definition.");
		if (value.format !== FORMAT) {
			if (typeof value.format === 'number' && value.format > FORMAT)
				fail('This app was made with a newer version. Update the app and try again.');
			fail("This isn't an app definition this version can read.");
		}
		const app: AppDefinition = {
			format: FORMAT,
			id: id(value.id, 'The app'),
			name: text(value.name, "The app's name", LIMITS.name) as string,
			private: value.private === true,
			blocks: []
		};
		const emoji = text(value.emoji, "The app's emoji", LIMITS.emoji, false);
		if (emoji !== undefined) app.emoji = emoji;
		const ids = new Set<string>();
		app.blocks = list(value.blocks, "The app's blocks", LIMITS.blocks).map((b, i) =>
			block(b, i + 1, ids)
		);
		return { ok: true, value: app };
	} catch (error) {
		if (error instanceof Invalid) return { ok: false, error: error.message };
		throw error;
	}
}

const tooBig = () => `This app is larger than ${LIMITS.bytes / 1024} KB.`;

function byteLength(s: string): number {
	return new TextEncoder().encode(s).length;
}
