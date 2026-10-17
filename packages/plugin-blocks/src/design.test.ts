import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
	NOT_AN_APP,
	NOT_AN_APP_FILE,
	dataOf,
	decodeDesign,
	designFile,
	designFragment,
	designOf,
	encodeDesign,
	readDesignFile
} from './design.js';
import { LIMITS, type AppDefinition } from './format.js';
import { templates } from './templates.js';

const mood = templates.find((t) => t.blocks.some((b) => b.type === 'log'))!;
const b64 = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64url');

/**
 * About the biggest definition the limits allow: full checklists of labels made of words picked
 * by a seeded generator, which compress about as well as real ones do.
 */
function maximal(): AppDefinition {
	const words = ['water', 'the', 'ferns', 'morning', 'walk', 'call', 'mum', 'read', 'ten', 'pages'];
	let seed = 7;
	const pick = () => words[(seed = (seed * 48271) % 2147483647) % words.length];
	const label = () => {
		let text = pick()!;
		while (text.length < LIMITS.label - 12) text += ` ${pick()}`;
		return text;
	};
	let items = 1;
	const app: AppDefinition = {
		format: 1,
		id: 'big',
		name: label().slice(0, LIMITS.name),
		private: false,
		blocks: []
	};
	for (let b = 0; b < LIMITS.blocks; b++) {
		const block = {
			id: `b${b}`,
			type: 'checklist' as const,
			label: label(),
			items: [] as { id: string; label: string }[]
		};
		app.blocks.push(block);
		while (block.items.length < LIMITS.checklistItems) {
			block.items.push({ id: `i${items++}`, label: label() });
			// Room for a longer id once it's imported.
			if (JSON.stringify(app).length > LIMITS.bytes - 64) {
				block.items.pop();
				return app;
			}
		}
	}
	return app;
}

describe('sharing a design', () => {
	it('shares the definition without its id, and comes back with a new one', async () => {
		expect(designOf(mood)).not.toHaveProperty('id');
		const data = await encodeDesign(mood);
		expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
		const back = await decodeDesign(data);
		expect(back.ok).toBe(true);
		if (!back.ok) return;
		expect(back.value.id).not.toBe(mood.id);
		expect({ ...back.value, id: mood.id }).toEqual(mood);
	});

	it('falls back to an uncompressed `u.` link, and reads one', async () => {
		const data = await encodeDesign(mood, false);
		expect(data.startsWith('u.')).toBe(true);
		const back = await decodeDesign(data);
		expect(back.ok && back.value.name).toBe(mood.name);
	});

	it('reads the fragment it makes, and only that', () => {
		expect(dataOf(designFragment('abc'))).toBe('abc');
		expect(dataOf('app=abc')).toBe('abc');
		expect(dataOf('#url=abc')).toBeUndefined();
		expect(dataOf('')).toBeUndefined();
	});

	it('rejects corrupt data, other formats and designs over the limits, all the same way', async () => {
		const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
		const bad = [
			'',
			'not base64!',
			'u.not base64!',
			b64('not deflate at all'),
			'u.' + b64('not json'),
			'u.' + b64(json([1, 2])),
			'u.' + b64(json({ ...designOf(mood), format: 2 })),
			'u.' + b64(json({ ...designOf(mood), name: 'x'.repeat(LIMITS.name + 1) })),
			b64(deflateRawSync(json({ ...designOf(mood), blocks: [{ id: 'x', type: 'timer' }] }))),
			// Small, but over the size limit once inflated.
			b64(deflateRawSync(Buffer.alloc(LIMITS.bytes + 1, 32))),
			'u.' + 'A'.repeat(LIMITS.bytes * 2)
		];
		for (const data of bad)
			expect(await decodeDesign(data), data.slice(0, 40)).toEqual({
				ok: false,
				error: NOT_AN_APP
			});
	});

	it('makes short links for everyday designs, and still reads the biggest one', async () => {
		const link = async (app: AppDefinition) =>
			`https://example.com/my-apps/import${designFragment(await encodeDesign(app))}`;
		for (const template of templates) expect((await link(template)).length).toBeLessThan(1000);
		// A design too big for a link is offered as a file only, but a link to one still opens.
		const big = maximal();
		expect(JSON.stringify(big).length).toBeGreaterThan(LIMITS.bytes - 300);
		const back = await decodeDesign(await encodeDesign(big));
		expect(back.ok && back.value.blocks).toEqual(big.blocks);
	});
});

describe('a design as a file', () => {
	it('names the file after the app, and reads it back with a new id', () => {
		const file = designFile({ ...mood, name: 'Café: mood & sleep!' });
		expect(file.name).toBe('cafe-mood-sleep.xcwds-app.json');
		expect(designFile({ ...mood, name: '🌙' }).name).toBe('app.xcwds-app.json');
		expect(JSON.parse(file.text)).not.toHaveProperty('id');
		const back = readDesignFile(file.text);
		expect(back.ok && back.value.id).not.toBe(mood.id);
		expect(back.ok && back.value.blocks).toEqual(mood.blocks);
		expect(readDesignFile(designFile(maximal()).text).ok).toBe(true);
	});

	it("says a file that isn't a design can't be opened", () => {
		for (const text of ['', '{', '[]', 'null', JSON.stringify({ format: 1, name: 'x' })])
			expect(readDesignFile(text)).toEqual({ ok: false, error: NOT_AN_APP_FILE });
		expect(readDesignFile(' '.repeat(LIMITS.bytes * 2 + 1))).toEqual({
			ok: false,
			error: NOT_AN_APP_FILE
		});
	});
});
