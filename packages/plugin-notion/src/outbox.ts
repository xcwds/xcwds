/**
 * Changes waiting to be sent to Notion (#109): ticking a to-do on a saved page, and adding a short
 * note at its end. They're saved on the device as they're made (`app:notion:outbox`, kept out of
 * backups), shown on the copy at once (`applyOutbox`), and sent in order by `flush` when the app is
 * back online.
 *
 * - **Conflicts:** before a tick is sent, its block is fetched again. If Notion has it the other way
 *   and it was edited there since the copy was downloaded (or since this device last wrote it),
 *   Notion's stays and `flush` reports a conflict to tell the person. Notion records edits to the
 *   minute, so an edit in the same minute as the download counts as newer.
 * - **Failures:** no connection, rate limits and Notion's own errors (`5xx`) keep the change queued
 *   and stop the flush; anything else Notion refuses (`4xx`) stays queued with its reason and isn't
 *   tried again until `retry`.
 * - **Twice:** a change is marked `attempted` (and saved) before it's sent. A note that may have
 *   reached Notion before the connection dropped is looked for at the end of the page before it's
 *   sent again, so it isn't added twice. Ticks are checked against Notion's value anyway.
 *
 * No browser globals; `flush` takes the client and an `update` that changes the saved outbox.
 */
import { NotionError, type NotionClient, type NotionErrorKind, type RawBlock } from './api.js';
import { plainText, richText, type Block, type NotionDocument } from './document.js';

/** The most paragraphs a note has, and the longest a paragraph is (Notion's limit). */
export const NOTE_PARAGRAPHS = 20;
export const PARAGRAPH_LENGTH = 2000;

/** A change someone made to a saved page. */
export type OutboxChange =
	{ kind: 'check'; block: string; checked: boolean } | { kind: 'note'; text: string };

/** Why Notion refused a change; it stays queued until `retry` or `discard`. */
export type OutboxFailure = { kind: NotionErrorKind; status?: number; code?: string };

/** A queued change. */
export type OutboxItem = {
	id: string;
	/** The source whose copy shows it. */
	source: string;
	/** The Notion page it belongs to (where a note goes). */
	page: string;
	queuedAt: number;
	/** A send was started; it may have reached Notion. */
	attempted?: true;
	failed?: OutboxFailure;
} & (
	| {
			kind: 'check';
			block: string;
			checked: boolean;
			/** Edits in Notion after this (ms) are newer than what the person saw. */
			since: number;
	  }
	| { kind: 'note'; text: string }
);

/**
 * The saved outbox: the queue, in order, and when this device's own ticks last edited each block
 * (ms, as Notion recorded it), so a tick right after another isn't taken for someone else's edit.
 */
export type Outbox = { items: OutboxItem[]; written: Record<string, number> };

export const emptyOutbox = (): Outbox => ({ items: [], written: {} });

const MINUTE = 60_000;
/** How long `written` keeps this device's edit of a block. */
const WRITTEN_KEPT = 7 * 24 * 60 * MINUTE;

/**
 * A note's text as paragraphs: one a line, empty lines left out, long lines cut at
 * `PARAGRAPH_LENGTH` (never inside a character). `undefined` when there's nothing to send or more
 * than `NOTE_PARAGRAPHS` paragraphs.
 */
export function noteParagraphs(text: string): string[] | undefined {
	const paragraphs: string[] = [];
	for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
		const trimmed = line.trimEnd();
		if (!trimmed.trim()) continue;
		let part = '';
		for (const char of trimmed) {
			if (part.length + char.length > PARAGRAPH_LENGTH) {
				paragraphs.push(part);
				part = '';
			}
			part += char;
		}
		paragraphs.push(part);
	}
	return paragraphs.length && paragraphs.length <= NOTE_PARAGRAPHS ? paragraphs : undefined;
}

/**
 * The outbox with `change` added, for the page `page` shown by `source`. `fetchedAt` is when that
 * copy was downloaded. A tick that undoes one still waiting removes both; the same tick twice is
 * kept once. Throws on a note `noteParagraphs` refuses.
 */
export function enqueue(
	outbox: Outbox,
	change: OutboxChange,
	{
		id,
		source,
		page,
		fetchedAt,
		now = Date.now()
	}: { id: string; source: string; page: string; fetchedAt: number; now?: number }
): Outbox {
	const base = { id, source, page, queuedAt: now };
	if (change.kind === 'note') {
		if (!noteParagraphs(change.text)) throw new RangeError('Not a note that can be sent.');
		return { ...outbox, items: [...outbox.items, { ...base, kind: 'note', text: change.text }] };
	}
	const waiting = outbox.items.findIndex(
		(item) =>
			item.kind === 'check' && item.block === change.block && !item.attempted && !item.failed
	);
	if (waiting >= 0) {
		const item = outbox.items[waiting] as Extract<OutboxItem, { kind: 'check' }>;
		if (item.checked === change.checked) return outbox;
		return { ...outbox, items: outbox.items.filter((_, i) => i !== waiting) };
	}
	// Notion's times are to the minute: an edit in the minute of the download counts as newer.
	const since = Math.max(
		Math.floor(fetchedAt / MINUTE) * MINUTE - 1,
		outbox.written[change.block] ?? -Infinity
	);
	// This device's own edits matter only until the copies are downloaded again.
	const written = Object.fromEntries(
		Object.entries(outbox.written).filter(([, at]) => at > now - WRITTEN_KEPT)
	);
	return {
		written,
		items: [
			...outbox.items,
			{ ...base, kind: 'check', block: change.block, checked: change.checked, since }
		]
	};
}

/** The outbox with a failed change cleared to be sent again. */
export function retry(outbox: Outbox, id: string): Outbox {
	return {
		...outbox,
		items: outbox.items.map((item) => {
			if (item.id !== id || !item.failed) return item;
			const { failed: _failed, ...rest } = item;
			return rest as OutboxItem;
		})
	};
}

/** The outbox without the change `id`. */
export function discard(outbox: Outbox, id: string): Outbox {
	return { ...outbox, items: outbox.items.filter((item) => item.id !== id) };
}

/** A paragraph of plain text, as a saved page shows a note. */
const paragraph = (text: string): Block => ({ type: 'paragraph', text: [{ text }] });

/**
 * `copy` as it will be once `source`'s queued changes are in Notion: to-dos ticked or unticked,
 * notes at the end. Failed changes show too, since they're still queued.
 */
export function applyOutbox(copy: NotionDocument, outbox: Outbox, source: string): NotionDocument {
	const items = outbox.items.filter((item) => item.source === source && item.page === copy.id);
	if (!items.length) return copy;
	const checks = new Map<string, boolean>();
	const notes: Block[] = [];
	for (const item of items) {
		if (item.kind === 'check') checks.set(item.block, item.checked);
		else notes.push(...(noteParagraphs(item.text) ?? []).map(paragraph));
	}
	const apply = (blocks: Block[]): Block[] =>
		blocks.map((block) => {
			let next = block;
			if (block.type === 'todo' && block.id && checks.has(block.id)) {
				next = { ...block, checked: checks.get(block.id)! };
			}
			if ('children' in next && next.children) next = { ...next, children: apply(next.children) };
			if (next.type === 'columns') next = { ...next, columns: next.columns.map(apply) };
			return next;
		});
	return { ...copy, blocks: [...apply(copy.blocks), ...notes] };
}

/** What sending one change came to. */
export type SendResult =
	/** In Notion now (or it already was); `edited` is when Notion recorded this device's tick. */
	| { status: 'sent'; edited?: number }
	/** Notion's was newer: `checked` is Notion's value, which stays. */
	| { status: 'conflict'; checked: boolean }
	/** Not sent this time (no connection, rate limited, Notion down): try again later. */
	| { status: 'later'; error: NotionError }
	/** Notion refused it. */
	| { status: 'failed'; failure: OutboxFailure };

/** The client calls `send` uses. */
export type OutboxClient = Pick<
	NotionClient,
	'block' | 'setChecked' | 'appendParagraphs' | 'allChildren'
>;

const edited = (block: RawBlock): number | undefined => {
	const at = typeof block.last_edited_time === 'string' ? Date.parse(block.last_edited_time) : NaN;
	return Number.isNaN(at) ? undefined : at;
};

const checkedOf = (block: RawBlock): boolean =>
	(block.to_do as { checked?: unknown } | undefined)?.checked === true;

/** Whether `blocks` end with exactly `paragraphs` (a note that already reached Notion). */
function endsWith(blocks: RawBlock[], paragraphs: string[]): boolean {
	if (blocks.length < paragraphs.length) return false;
	const tail = blocks.slice(blocks.length - paragraphs.length);
	return tail.every(
		(block, i) =>
			block.type === 'paragraph' &&
			plainText(richText((block.paragraph as { rich_text?: unknown } | undefined)?.rich_text)) ===
				paragraphs[i]
	);
}

/** Sends one change, after the conflict check for a tick. */
export async function send(client: OutboxClient, item: OutboxItem): Promise<SendResult> {
	try {
		if (item.kind === 'check') {
			const block = await client.block(item.block);
			if (block.type !== 'to_do' || block.archived === true || block.in_trash === true) {
				// It was read fine, so it's gone from the page rather than not shared.
				return { status: 'failed', failure: { kind: 'failed', code: 'not_a_to_do' } };
			}
			const current = checkedOf(block);
			if (current === item.checked) return { status: 'sent' };
			if ((edited(block) ?? Infinity) > item.since) return { status: 'conflict', checked: current };
			const updated = await client.setChecked(item.block, item.checked);
			return { status: 'sent', edited: edited(updated) };
		}
		const paragraphs = noteParagraphs(item.text);
		if (!paragraphs) return { status: 'failed', failure: { kind: 'failed', code: 'empty_note' } };
		if (item.attempted && endsWith(await client.allChildren(item.page), paragraphs)) {
			return { status: 'sent' };
		}
		await client.appendParagraphs(item.page, paragraphs);
		return { status: 'sent' };
	} catch (error) {
		if (!(error instanceof NotionError)) throw error;
		if (
			error.kind === 'offline' ||
			error.kind === 'rate-limited' ||
			error.kind === 'aborted' ||
			(error.status ?? 0) >= 500
		) {
			return { status: 'later', error };
		}
		return {
			status: 'failed',
			failure: {
				kind: error.kind,
				...(error.status === undefined ? {} : { status: error.status }),
				...(error.code === undefined ? {} : { code: error.code })
			}
		};
	}
}

/** What a `flush` did. */
export type FlushResult = {
	outbox: Outbox;
	/** Sent, in order. */
	sent: OutboxItem[];
	/** Ticks Notion had the other way, with Notion's value (which the next download shows). */
	conflicts: { item: OutboxItem; checked: boolean }[];
	/** Refused this time; they stay queued with `failed`. */
	failed: OutboxItem[];
	/** Why it stopped before the end, when it did; what's left is still queued. */
	stopped?: NotionError;
};

/**
 * Applies `change` to the latest saved outbox, saves the result and returns it. Changes queued by
 * the page while a flush runs are in the latest one, so they're kept (and sent on this flush).
 */
export type OutboxUpdate = (change: (latest: Outbox) => Outbox) => Outbox | Promise<Outbox>;

/** `outbox` with the item `id` replaced by `next(item)`, or removed when `next` returns nothing. */
function replace(
	outbox: Outbox,
	id: string,
	next: (item: OutboxItem) => OutboxItem | undefined
): Outbox {
	const items: OutboxItem[] = [];
	for (const item of outbox.items) {
		const kept = item.id === id ? next(item) : item;
		if (kept) items.push(kept);
	}
	return { ...outbox, items };
}

/**
 * Sends the queued changes in order, skipping failed ones, until one has to wait. Every step goes
 * through `update`: marking a change `attempted` before it's sent (so a page closed mid-send knows
 * what may have gone, and `enqueue` no longer cancels it) and recording each answer. A change
 * discarded while it was being sent stays discarded.
 */
export async function flush(client: OutboxClient, update: OutboxUpdate): Promise<FlushResult> {
	const result: Omit<FlushResult, 'outbox'> = { sent: [], conflicts: [], failed: [] };
	const tried = new Set<string>();
	let outbox = await update((latest) => latest);
	for (;;) {
		const next = outbox.items.find((item) => !item.failed && !tried.has(item.id));
		if (!next) break;
		const id = next.id;
		tried.add(id);
		// As it was before this send: whether it may already be in Notion.
		const before: { item?: OutboxItem } = {};
		outbox = await update((latest) =>
			replace(latest, id, (item) => {
				before.item = item;
				return { ...item, attempted: true };
			})
		);
		const queued = before.item;
		if (!queued || queued.failed) continue;
		const item: OutboxItem = { ...queued, attempted: true };
		const answer = await send(client, queued);
		if (answer.status === 'later') {
			result.stopped = answer.error;
			break;
		}
		if (answer.status === 'failed') {
			// A refusal (4xx) means it didn't land; anything else might have.
			const status = answer.failure.status ?? 0;
			const landed = !(status >= 400 && status < 500);
			const { attempted: _attempted, ...rest } = item;
			const failed = { ...(landed ? item : rest), failed: answer.failure } as OutboxItem;
			outbox = await update((latest) => replace(latest, id, () => failed));
			result.failed.push(failed);
			continue;
		}
		if (answer.status === 'conflict') result.conflicts.push({ item, checked: answer.checked });
		else result.sent.push(item);
		const at = answer.status === 'sent' && item.kind === 'check' ? answer.edited : undefined;
		outbox = await update((latest) => {
			const done = replace(latest, id, () => undefined);
			if (at === undefined || item.kind !== 'check') return done;
			return {
				written: { ...done.written, [item.block]: at },
				// Later ticks of the same block come after this device's own edit.
				items: done.items.map((later) =>
					later.kind === 'check' && later.block === item.block && later.since < at
						? { ...later, since: at }
						: later
				)
			};
		});
	}
	return { outbox, ...result };
}

const KINDS: ReadonlySet<string> = new Set([
	'offline',
	'unauthorized',
	'not-shared',
	'rate-limited',
	'aborted',
	'failed'
]);

const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isTime = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

function parseItem(value: unknown): OutboxItem | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const raw = value as Record<string, unknown>;
	if (!isString(raw.id) || !isString(raw.source) || !isString(raw.page) || !isTime(raw.queuedAt)) {
		return undefined;
	}
	const base = {
		id: raw.id,
		source: raw.source,
		page: raw.page,
		queuedAt: raw.queuedAt,
		...(raw.attempted === true ? { attempted: true as const } : {})
	};
	let failed: OutboxFailure | undefined;
	if (raw.failed !== undefined) {
		const f = raw.failed as Record<string, unknown> | null;
		if (!f || typeof f !== 'object' || typeof f.kind !== 'string' || !KINDS.has(f.kind)) {
			return undefined;
		}
		failed = {
			kind: f.kind as NotionErrorKind,
			...(isTime(f.status) ? { status: f.status } : {}),
			...(isString(f.code) ? { code: f.code } : {})
		};
	}
	const extra = failed ? { failed } : {};
	if (raw.kind === 'check') {
		if (!isString(raw.block) || typeof raw.checked !== 'boolean' || !isTime(raw.since)) {
			return undefined;
		}
		return {
			...base,
			...extra,
			kind: 'check',
			block: raw.block,
			checked: raw.checked,
			since: raw.since
		};
	}
	if (raw.kind === 'note' && typeof raw.text === 'string' && noteParagraphs(raw.text)) {
		return { ...base, ...extra, kind: 'note', text: raw.text };
	}
	return undefined;
}

/**
 * A saved outbox, or `undefined` if `value` isn't one (the validator for `app:notion:outbox`).
 * One item that isn't valid fails the whole outbox, so a bad write is noticed, not half-sent.
 */
export function parseOutbox(value: unknown): Outbox | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const raw = value as Record<string, unknown>;
	if (!Array.isArray(raw.items) || !raw.written || typeof raw.written !== 'object')
		return undefined;
	const items: OutboxItem[] = [];
	const ids = new Set<string>();
	for (const entry of raw.items) {
		const item = parseItem(entry);
		if (!item || ids.has(item.id)) return undefined;
		ids.add(item.id);
		items.push(item);
	}
	const written: Record<string, number> = {};
	for (const [block, at] of Object.entries(raw.written as Record<string, unknown>)) {
		if (!isTime(at)) return undefined;
		written[block] = at;
	}
	return { items, written };
}
