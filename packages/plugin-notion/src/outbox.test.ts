import { describe, expect, it, vi } from 'vitest';
import { NotionError, type RawBlock } from './api.js';
import { DOCUMENT_VERSION, type NotionDocument } from './document.js';
import {
	NOTE_PARAGRAPHS,
	PARAGRAPH_LENGTH,
	applyOutbox,
	discard,
	emptyOutbox,
	enqueue,
	flush,
	noteParagraphs,
	parseOutbox,
	retry,
	send,
	type Outbox,
	type OutboxClient,
	type OutboxItem
} from './outbox.js';

const PAGE = 'page-1';
const MINUTE = 60_000;
/** When the copy was downloaded: 10:05:40. */
const FETCHED = Date.parse('2026-10-25T10:05:40.000Z');
const at = (iso: string) => new Date(iso).toISOString();

let ids = 0;
const add = (outbox: Outbox, change: Parameters<typeof enqueue>[1], now = FETCHED + 1000) =>
	enqueue(outbox, change, { id: `c${++ids}`, source: 's1', page: PAGE, fetchedAt: FETCHED, now });

const todo = (id: string, checked: boolean, edited = '2026-10-01T08:00:00.000Z'): RawBlock => ({
	id,
	type: 'to_do',
	last_edited_time: edited,
	to_do: { rich_text: [], checked }
});

const para = (text: string): RawBlock => ({
	id: `p-${text}`,
	type: 'paragraph',
	paragraph: { rich_text: [{ plain_text: text }] }
});

/** A Notion standing in for the client: blocks by id, and a page's children. */
function fakeNotion(blocks: Record<string, RawBlock> = {}, children: RawBlock[] = []) {
	const client = {
		block: vi.fn(async (id: string) => {
			const block = blocks[id];
			if (!block) throw new NotionError('not-shared', 404, 'object_not_found');
			return structuredClone(block);
		}),
		setChecked: vi.fn(async (id: string, checked: boolean) => {
			blocks[id] = todo(id, checked, '2026-10-25T10:07:00.000Z');
			return structuredClone(blocks[id]!);
		}),
		appendParagraphs: vi.fn(async (_id: string, paragraphs: string[]) => {
			const added = paragraphs.map(para);
			children.push(...added);
			return { results: added, has_more: false, next_cursor: null };
		}),
		allChildren: vi.fn(async () => structuredClone(children))
	} satisfies OutboxClient;
	return { client, blocks, children };
}

describe('noteParagraphs', () => {
	it('makes one paragraph a line, leaving out empty lines and cutting long ones', () => {
		expect(noteParagraphs('Called the vet\r\n\n  \nNext week ')).toEqual([
			'Called the vet',
			'Next week'
		]);
		expect(noteParagraphs('  indented')).toEqual(['  indented']);
		const long = 'a'.repeat(PARAGRAPH_LENGTH) + 'b';
		expect(noteParagraphs(long)).toEqual(['a'.repeat(PARAGRAPH_LENGTH), 'b']);
		// Never inside a character: an emoji is two UTF-16 units.
		const emoji = 'a'.repeat(PARAGRAPH_LENGTH - 1) + '🐶';
		const parts = noteParagraphs(emoji)!;
		expect(parts).toEqual(['a'.repeat(PARAGRAPH_LENGTH - 1), '🐶']);
		expect(parts.every((part) => part.length <= PARAGRAPH_LENGTH)).toBe(true);
	});

	it('refuses an empty note or one too long to send at once', () => {
		expect(noteParagraphs('')).toBeUndefined();
		expect(noteParagraphs(' \n\n ')).toBeUndefined();
		expect(noteParagraphs(Array(NOTE_PARAGRAPHS).fill('x').join('\n'))).toHaveLength(
			NOTE_PARAGRAPHS
		);
		expect(
			noteParagraphs(
				Array(NOTE_PARAGRAPHS + 1)
					.fill('x')
					.join('\n')
			)
		).toBeUndefined();
	});
});

describe('enqueue', () => {
	it('queues ticks and notes in order, with the time Notion edits count from', () => {
		let outbox = add(emptyOutbox(), { kind: 'check', block: 'b1', checked: true });
		outbox = add(outbox, { kind: 'note', text: 'Done' });
		expect(outbox.items).toMatchObject([
			{
				kind: 'check',
				block: 'b1',
				checked: true,
				source: 's1',
				page: PAGE,
				// The start of the download's minute: Notion's times are to the minute.
				since: Date.parse('2026-10-25T10:05:00.000Z') - 1
			},
			{ kind: 'note', text: 'Done' }
		]);
		expect(() => add(outbox, { kind: 'note', text: '  ' })).toThrow(RangeError);
	});

	it('drops a tick undone before it was sent, and keeps the same tick once', () => {
		const once = add(emptyOutbox(), { kind: 'check', block: 'b1', checked: true });
		expect(add(once, { kind: 'check', block: 'b1', checked: true })).toBe(once);
		expect(add(once, { kind: 'check', block: 'b1', checked: false }).items).toEqual([]);
		// One that may already be in Notion stays, and the undo is queued after it.
		const attempted: Outbox = { ...once, items: [{ ...once.items[0]!, attempted: true }] };
		expect(add(attempted, { kind: 'check', block: 'b1', checked: false }).items).toMatchObject([
			{ checked: true, attempted: true },
			{ checked: false }
		]);
	});

	it("counts from this device's own last edit of the block, for a week", () => {
		const edited = Date.parse('2026-10-25T10:07:00.000Z');
		const outbox: Outbox = {
			items: [],
			written: { b1: edited, old: FETCHED - 8 * 24 * 60 * MINUTE }
		};
		const next = add(outbox, { kind: 'check', block: 'b1', checked: false });
		expect(next.items[0]).toMatchObject({ since: edited });
		expect(next.written).toEqual({ b1: edited });
	});
});

describe('retry and discard', () => {
	it('clears a failure, or removes the change', () => {
		const outbox = add(emptyOutbox(), { kind: 'note', text: 'Hi' });
		const id = outbox.items[0]!.id;
		const failed: Outbox = {
			...outbox,
			items: [{ ...outbox.items[0]!, failed: { kind: 'unauthorized', status: 401 } }]
		};
		expect(retry(failed, id).items[0]).not.toHaveProperty('failed');
		expect(retry(failed, 'other')).toEqual(failed);
		expect(discard(failed, id).items).toEqual([]);
	});
});

describe('applyOutbox', () => {
	const copy: NotionDocument = {
		v: DOCUMENT_VERSION,
		id: PAGE,
		title: 'Agenda',
		icon: null,
		url: null,
		createdTime: null,
		properties: [],
		blocks: [
			{ type: 'todo', id: 'b1', text: [{ text: 'Walk the dog' }], checked: false },
			{
				type: 'toggle',
				text: [{ text: 'Later' }],
				children: [{ type: 'todo', id: 'b2', text: [{ text: 'Vet' }], checked: true }]
			},
			{
				type: 'columns',
				columns: [[{ type: 'todo', id: 'b3', text: [{ text: 'Left' }], checked: false }], []]
			},
			// From a copy saved before to-dos kept their ids.
			{ type: 'todo', text: [{ text: 'Old' }], checked: false }
		],
		fetchedAt: FETCHED,
		truncated: false
	};

	it("shows the source's queued ticks and notes on its copy", () => {
		let outbox = add(emptyOutbox(), { kind: 'check', block: 'b1', checked: true });
		outbox = add(outbox, { kind: 'check', block: 'b2', checked: false });
		outbox = add(outbox, { kind: 'check', block: 'b3', checked: true });
		outbox = add(outbox, { kind: 'note', text: 'Fed\nWalked' });
		outbox = enqueue(
			outbox,
			{ kind: 'check', block: 'b1', checked: true },
			{
				id: 'other-source',
				source: 's2',
				page: PAGE,
				fetchedAt: FETCHED
			}
		);
		const shown = applyOutbox(copy, outbox, 's1');
		expect(shown.blocks).toEqual([
			{ ...copy.blocks[0], checked: true },
			{
				...copy.blocks[1],
				children: [{ type: 'todo', id: 'b2', text: [{ text: 'Vet' }], checked: false }]
			},
			{
				type: 'columns',
				columns: [[{ type: 'todo', id: 'b3', text: [{ text: 'Left' }], checked: true }], []]
			},
			copy.blocks[3],
			{ type: 'paragraph', text: [{ text: 'Fed' }] },
			{ type: 'paragraph', text: [{ text: 'Walked' }] }
		]);
		// The saved copy itself is untouched, and a source with nothing queued gets it back as is.
		expect(copy.blocks[0]).toMatchObject({ checked: false });
		expect(applyOutbox(copy, emptyOutbox(), 's1')).toBe(copy);
		expect(applyOutbox(copy, outbox, 's3')).toBe(copy);
	});
});

describe('send', () => {
	const check = (checked: boolean, block = 'b1') =>
		add(emptyOutbox(), { kind: 'check', block, checked }).items[0]!;

	it('ticks a to-do Notion still has as the copy showed it', async () => {
		const { client } = fakeNotion({ b1: todo('b1', false) });
		expect(await send(client, check(true))).toEqual({
			status: 'sent',
			edited: Date.parse('2026-10-25T10:07:00.000Z')
		});
		expect(client.setChecked).toHaveBeenCalledWith('b1', true);
	});

	it('sends nothing when Notion already has it that way', async () => {
		const { client } = fakeNotion({ b1: todo('b1', true, at('2026-10-25T11:00:00Z')) });
		expect(await send(client, check(true))).toEqual({ status: 'sent' });
		expect(client.setChecked).not.toHaveBeenCalled();
	});

	it("keeps Notion's when it was edited there since the download", async () => {
		// Edited in the download's own minute: counted as newer.
		for (const edited of ['2026-10-25T10:05:00.000Z', '2026-10-25T10:30:00.000Z']) {
			const { client } = fakeNotion({ b1: todo('b1', false, edited) });
			expect(await send(client, check(true)), edited).toEqual({
				status: 'conflict',
				checked: false
			});
			expect(client.setChecked).not.toHaveBeenCalled();
		}
		// Edited the minute before: older than what the person saw.
		const { client } = fakeNotion({ b1: todo('b1', false, '2026-10-25T10:04:00.000Z') });
		expect(await send(client, check(true))).toMatchObject({ status: 'sent' });
	});

	it("fails a block that isn't a to-do any more", async () => {
		for (const block of [
			{ ...todo('b1', false), in_trash: true },
			{ ...todo('b1', false), archived: true },
			para('b1')
		]) {
			const { client } = fakeNotion({ b1: block });
			expect(await send(client, check(true))).toEqual({
				status: 'failed',
				failure: { kind: 'not-shared', code: 'not_a_to_do' }
			});
		}
	});

	it('adds a note at the end of the page, once', async () => {
		const { client, children } = fakeNotion({}, [para('Agenda')]);
		const item = add(emptyOutbox(), { kind: 'note', text: 'Fed\nWalked' }).items[0]!;
		expect(await send(client, item)).toEqual({ status: 'sent' });
		expect(client.appendParagraphs).toHaveBeenCalledWith(PAGE, ['Fed', 'Walked']);
		expect(client.allChildren).not.toHaveBeenCalled();
		// Tried before and it got there: not added again.
		expect(await send(client, { ...item, attempted: true })).toEqual({ status: 'sent' });
		expect(client.appendParagraphs).toHaveBeenCalledOnce();
		expect(children).toHaveLength(3);
		// Tried before and it didn't: sent.
		const other = {
			...add(emptyOutbox(), { kind: 'note', text: 'New' }).items[0]!,
			attempted: true as const
		};
		expect(await send(client, other)).toEqual({ status: 'sent' });
		expect(client.appendParagraphs).toHaveBeenCalledTimes(2);
	});

	it('waits on no connection, rate limits and Notion errors, and fails on refusals', async () => {
		const failing = (error: unknown) => {
			const { client } = fakeNotion();
			client.block.mockRejectedValue(error);
			client.appendParagraphs.mockRejectedValue(error);
			return client;
		};
		for (const error of [
			new NotionError('offline'),
			new NotionError('rate-limited', 429),
			new NotionError('aborted'),
			new NotionError('failed', 503, 'service_unavailable')
		]) {
			expect(await send(failing(error), check(true))).toEqual({ status: 'later', error });
		}
		expect(
			await send(failing(new NotionError('unauthorized', 401, 'unauthorized')), check(true))
		).toEqual({
			status: 'failed',
			failure: { kind: 'unauthorized', status: 401, code: 'unauthorized' }
		});
		const note = add(emptyOutbox(), { kind: 'note', text: 'Hi' }).items[0]!;
		expect(
			await send(failing(new NotionError('failed', 403, 'restricted_resource')), note)
		).toEqual({
			status: 'failed',
			failure: { kind: 'failed', status: 403, code: 'restricted_resource' }
		});
		await expect(send(failing(new TypeError('bug')), note)).rejects.toThrow(TypeError);
	});
});

describe('flush', () => {
	it('sends in order, saving before each send and after each answer', async () => {
		const { client, children } = fakeNotion({ b1: todo('b1', false), b2: todo('b2', true) });
		let outbox = add(emptyOutbox(), { kind: 'check', block: 'b1', checked: true });
		outbox = add(outbox, { kind: 'note', text: 'Done' });
		outbox = add(outbox, { kind: 'check', block: 'b2', checked: false });
		const saved: Outbox[] = [];
		const result = await flush(client, outbox, (next) => void saved.push(structuredClone(next)));
		expect(result.sent.map((item) => item.id)).toEqual(outbox.items.map((item) => item.id));
		expect(result).toMatchObject({ conflicts: [], failed: [], outbox: { items: [] } });
		expect(result.stopped).toBeUndefined();
		expect(children.map((block) => block.id)).toEqual(['p-Done']);
		expect(result.outbox.written).toEqual({
			b1: Date.parse('2026-10-25T10:07:00.000Z'),
			b2: Date.parse('2026-10-25T10:07:00.000Z')
		});
		// Before the first send, it's marked as attempted.
		expect(saved[0]!.items[0]).toMatchObject({ attempted: true });
		expect(saved).toHaveLength(6);
	});

	it("takes a tick right after this device's own for the same block as no conflict", async () => {
		const { client, blocks } = fakeNotion({ b1: todo('b1', false) });
		let outbox = add(emptyOutbox(), { kind: 'check', block: 'b1', checked: true });
		outbox = (await flush(client, outbox, () => {})).outbox;
		// Unticked again before the copy was downloaded again.
		outbox = add(outbox, { kind: 'check', block: 'b1', checked: false }, FETCHED + 2 * MINUTE);
		const result = await flush(client, outbox, () => {});
		expect(result.conflicts).toEqual([]);
		expect(blocks.b1).toMatchObject({ to_do: { checked: false } });
	});

	it('stops at the first change that has to wait, and leaves it and the rest queued', async () => {
		const { client } = fakeNotion({ b1: todo('b1', false) });
		client.appendParagraphs.mockRejectedValueOnce(new NotionError('offline'));
		let outbox = add(emptyOutbox(), { kind: 'check', block: 'b1', checked: true });
		outbox = add(outbox, { kind: 'note', text: 'Done' });
		outbox = add(outbox, { kind: 'note', text: 'Later' });
		const result = await flush(client, outbox, () => {});
		expect(result.sent).toHaveLength(1);
		expect(result.stopped).toMatchObject({ kind: 'offline' });
		expect(result.outbox.items).toMatchObject([
			{ text: 'Done', attempted: true },
			{ text: 'Later' }
		]);
		expect(result.outbox.items[1]).not.toHaveProperty('attempted');
		// Next time, the note that may have gone is looked for before it's sent.
		const again = await flush(client, result.outbox, () => {});
		expect(client.allChildren).toHaveBeenCalledOnce();
		expect(again.sent).toHaveLength(2);
	});

	it('reports conflicts, keeps refusals queued without trying them again, and goes on', async () => {
		const { client } = fakeNotion({ b1: todo('b1', false, '2026-10-25T11:00:00.000Z') });
		client.appendParagraphs.mockRejectedValueOnce(new NotionError('unauthorized', 401));
		let outbox = add(emptyOutbox(), { kind: 'check', block: 'b1', checked: true });
		outbox = add(outbox, { kind: 'note', text: 'Refused' });
		outbox = add(outbox, { kind: 'note', text: 'Fine' });
		const result = await flush(client, outbox, () => {});
		expect(result.conflicts).toMatchObject([{ item: { block: 'b1' }, checked: false }]);
		expect(result.failed).toMatchObject([{ text: 'Refused', failed: { kind: 'unauthorized' } }]);
		expect(result.sent).toMatchObject([{ text: 'Fine' }]);
		// A refusal didn't reach Notion, so it isn't marked as maybe sent.
		expect(result.outbox.items).toHaveLength(1);
		expect(result.outbox.items[0]).not.toHaveProperty('attempted');
		const calls = client.appendParagraphs.mock.calls.length;
		const again = await flush(client, result.outbox, () => {});
		expect(client.appendParagraphs).toHaveBeenCalledTimes(calls);
		expect(again.outbox).toEqual(result.outbox);
		// Until the person retries it.
		const retried = await flush(client, retry(again.outbox, again.outbox.items[0]!.id), () => {});
		expect(retried.sent).toHaveLength(1);
	});
});

describe('parseOutbox', () => {
	it('reads back what it saves', () => {
		let outbox = add(emptyOutbox(), { kind: 'check', block: 'b1', checked: true });
		outbox = add(outbox, { kind: 'note', text: 'Hi' });
		const items: OutboxItem[] = [
			{ ...outbox.items[0]!, attempted: true },
			{ ...outbox.items[1]!, failed: { kind: 'unauthorized', status: 401, code: 'unauthorized' } }
		];
		const saved = JSON.parse(JSON.stringify({ items, written: { b1: 5 } }));
		expect(parseOutbox(saved)).toEqual({ items, written: { b1: 5 } });
		expect(parseOutbox(emptyOutbox())).toEqual(emptyOutbox());
	});

	it('refuses anything else, as a whole', () => {
		const good = add(emptyOutbox(), { kind: 'check', block: 'b1', checked: true });
		const item = good.items[0]!;
		for (const bad of [
			null,
			[],
			'x',
			{ items: [] },
			{ items: {}, written: {} },
			{ items: [], written: { b1: 'soon' } },
			{ items: [item, item], written: {} },
			{ items: [{ ...item, kind: 'delete' }], written: {} },
			{ items: [{ ...item, checked: 'yes' }], written: {} },
			{ items: [{ ...item, since: undefined }], written: {} },
			{ items: [{ ...item, id: '' }], written: {} },
			{ items: [{ ...item, failed: { kind: 'boom' } }], written: {} },
			{ items: [{ ...item, kind: 'note', text: ' ' }], written: {} }
		]) {
			expect(parseOutbox(bad), JSON.stringify(bad)).toBeUndefined();
		}
	});
});
