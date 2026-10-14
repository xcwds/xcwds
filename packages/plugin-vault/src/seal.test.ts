import { describe, expect, it } from 'vitest';
import {
	MAX_ITERATIONS,
	MIN_ITERATIONS,
	deriveKey,
	newSalt,
	open,
	openWithPasscode,
	parsePasscodeSealed,
	parseSealed,
	seal,
	sealWithPasscode
} from './seal.js';

// The floor keeps the tests quick; the default is the same code with more rounds.
const FAST = MIN_ITERATIONS;
const SECRET = 'Week 3: cycle day 12, notes about a private thing';

describe('seal and open', () => {
	it('round-trips text, including an empty string and non-ASCII', async () => {
		const key = await deriveKey('123456', newSalt(), FAST);
		for (const text of [SECRET, '', 'crème brûlée 🍮']) {
			expect(await open(key, await seal(key, text, 'group'), 'group')).toBe(text);
		}
	});

	it('round-trips text larger than one base64 chunk', async () => {
		const key = await deriveKey('123456', newSalt(), FAST);
		const text = 'x'.repeat(300_000);
		expect(await open(key, await seal(key, text, 'group'), 'group')).toBe(text);
	});

	it('never puts the plaintext in the sealed value', async () => {
		const key = await deriveKey('123456', newSalt(), FAST);
		const sealed = JSON.stringify(await seal(key, SECRET, 'group'));
		expect(sealed).not.toContain('cycle');
		expect(sealed).not.toContain(btoa('cycle day'));
	});

	it('uses a fresh IV every time', async () => {
		const key = await deriveKey('123456', newSalt(), FAST);
		const a = await seal(key, SECRET, 'group');
		const b = await seal(key, SECRET, 'group');
		expect(a.iv).not.toBe(b.iv);
		expect(a.data).not.toBe(b.data);
	});

	it("doesn't open with a wrong passcode or another salt", async () => {
		const salt = newSalt();
		const sealed = await seal(await deriveKey('123456', salt, FAST), SECRET, 'group');
		expect(await open(await deriveKey('123457', salt, FAST), sealed, 'group')).toBeUndefined();
		expect(await open(await deriveKey('123456', newSalt(), FAST), sealed, 'group')).toBeUndefined();
	});

	it("doesn't open in another context", async () => {
		const key = await deriveKey('123456', newSalt(), FAST);
		expect(await open(key, await seal(key, SECRET, 'cycle'), 'notes')).toBeUndefined();
	});

	it("doesn't open changed data or a changed IV", async () => {
		const key = await deriveKey('123456', newSalt(), FAST);
		const sealed = await seal(key, SECRET, 'group');
		const flip = (text: string) => {
			const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
			bytes[0]! ^= 1;
			return btoa(String.fromCharCode(...bytes));
		};
		expect(await open(key, { ...sealed, data: flip(sealed.data) }, 'group')).toBeUndefined();
		expect(await open(key, { ...sealed, iv: flip(sealed.iv) }, 'group')).toBeUndefined();
	});

	it('makes keys that can never be exported', async () => {
		const key = await deriveKey('123456', newSalt(), FAST);
		expect(key.extractable).toBe(false);
		await expect(globalThis.crypto.subtle.exportKey('raw', key)).rejects.toThrow();
	});

	it('refuses iterations outside the allowed range and a short salt', async () => {
		await expect(deriveKey('123456', newSalt(), MIN_ITERATIONS - 1)).rejects.toThrow(RangeError);
		await expect(deriveKey('123456', newSalt(), MAX_ITERATIONS + 1)).rejects.toThrow(RangeError);
		await expect(deriveKey('123456', btoa('short'), FAST)).rejects.toThrow(TypeError);
	});
});

describe('parseSealed', () => {
	it('accepts what seal makes and rejects anything else', async () => {
		const key = await deriveKey('123456', newSalt(), FAST);
		const sealed = await seal(key, SECRET, 'group');
		expect(parseSealed(sealed)).toEqual(sealed);
		expect(parseSealed(JSON.parse(JSON.stringify(sealed)))).toEqual(sealed);
		for (const bad of [
			undefined,
			null,
			'text',
			[],
			{ ...sealed, v: 2 },
			{ ...sealed, iv: 'not base64!' },
			{ ...sealed, iv: btoa('eleven byte') },
			{ ...sealed, data: btoa('too short') },
			{ v: 1, iv: sealed.iv }
		])
			expect(parseSealed(bad)).toBeUndefined();
	});
});

describe('passcode sealing (backups)', () => {
	it('round-trips with the passcode and fails with another', async () => {
		const sealed = await sealWithPasscode('correct horse', SECRET, 'backup', FAST);
		expect(sealed.iterations).toBe(FAST);
		expect(await openWithPasscode('correct horse', sealed, 'backup')).toBe(SECRET);
		expect(await openWithPasscode('correct horsf', sealed, 'backup')).toBeUndefined();
		expect(JSON.stringify(sealed)).not.toContain('cycle');
	});

	it('uses a fresh salt every time', async () => {
		const a = await sealWithPasscode('correct horse', SECRET, 'backup', FAST);
		const b = await sealWithPasscode('correct horse', SECRET, 'backup', FAST);
		expect(a.salt).not.toBe(b.salt);
	});

	it('rejects edited key parameters without deriving anything', async () => {
		const sealed = await sealWithPasscode('correct horse', SECRET, 'backup', FAST);
		expect(parsePasscodeSealed(sealed)).toEqual(sealed);
		for (const bad of [
			{ ...sealed, iterations: 1 },
			{ ...sealed, iterations: 1e12 },
			{ ...sealed, iterations: '600000' },
			{ ...sealed, salt: btoa('short') },
			{ ...sealed, salt: undefined }
		]) {
			expect(parsePasscodeSealed(bad)).toBeUndefined();
			expect(await openWithPasscode('correct horse', bad, 'backup')).toBeUndefined();
		}
	});
});
