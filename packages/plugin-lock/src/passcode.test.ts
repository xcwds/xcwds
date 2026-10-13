import { describe, expect, it } from 'vitest';
import {
	FREE_TRIES,
	ITERATIONS,
	NO_ATTEMPTS,
	createVerifier,
	failed,
	parseAttempts,
	parseVerifier,
	passcodeProblem,
	sameBytes,
	verify,
	waitAfter
} from './passcode.js';

describe('passcode rules', () => {
	it('needs 6+ digits or an 8+ character passphrase', () => {
		expect(passcodeProblem('123456', 'digits')).toBeUndefined();
		expect(passcodeProblem('12345', 'digits')).toBe('Use at least 6 digits.');
		expect(passcodeProblem('12345a', 'digits')).toMatch(/digits only/);
		expect(passcodeProblem('correct horse', 'passphrase')).toBeUndefined();
		expect(passcodeProblem('seven77', 'passphrase')).toBe('Use at least 8 characters.');
		expect(passcodeProblem('        ', 'passphrase')).toBe('Type a passphrase.');
		// Characters, not UTF-16 units: four emoji are four characters.
		expect(passcodeProblem('🔒🔒🔒🔒', 'passphrase')).toBe('Use at least 8 characters.');
		expect(passcodeProblem('x'.repeat(257), 'passphrase')).toMatch(/at most 256/);
	});
});

describe('the verifier', () => {
	it('round-trips with WebCrypto, never holding the passcode', async () => {
		const v = await createVerifier('123456', 'digits', 1000);
		expect(JSON.stringify(v)).not.toContain('123456');
		expect(v).toMatchObject({ kind: 'digits', iterations: 1000 });
		expect(await verify('123456', v)).toBe(true);
		expect(await verify('123457', v)).toBe(false);
		expect(await verify('', v)).toBe(false);
		// A fresh salt each time.
		const again = await createVerifier('123456', 'digits', 1000);
		expect(again.salt).not.toBe(v.salt);
		expect(again.hash).not.toBe(v.hash);
		expect(ITERATIONS).toBe(600_000);
	});

	it('parses only well-formed verifiers, with a floor on iterations', async () => {
		const v = await createVerifier('a long passphrase', 'passphrase', 1000);
		expect(parseVerifier(v)).toBeUndefined();
		const saved = { ...v, iterations: 600_000 };
		expect(parseVerifier(saved)).toEqual(saved);
		expect(parseVerifier({ ...saved, kind: 'pin' })).toBeUndefined();
		expect(parseVerifier({ ...saved, salt: 'not base64!' })).toBeUndefined();
		expect(parseVerifier({ ...saved, hash: 3 })).toBeUndefined();
		expect(parseVerifier(null)).toBeUndefined();
	});

	it('compares every byte', () => {
		const a = Uint8Array.of(1, 2, 3);
		expect(sameBytes(a, Uint8Array.of(1, 2, 3))).toBe(true);
		expect(sameBytes(a, Uint8Array.of(1, 2, 4))).toBe(false);
		expect(sameBytes(a, Uint8Array.of(1, 2))).toBe(false);
		expect(sameBytes(a, Uint8Array.of(1, 2, 3, 0))).toBe(false);
	});
});

describe('wrong tries', () => {
	it('are free five times, then wait 30 s, 1 min, 5 min, 15 min, then an hour', () => {
		expect(FREE_TRIES).toBe(5);
		const waits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(waitAfter);
		expect(waits).toEqual([0, 0, 0, 0, 30_000, 60_000, 300_000, 900_000, 3_600_000, 3_600_000]);
		let attempts = NO_ATTEMPTS;
		for (let i = 0; i < 4; i++) attempts = failed(attempts, 1000);
		expect(attempts).toEqual({ failures: 4, retryAt: 0 });
		expect(failed(attempts, 1000)).toEqual({ failures: 5, retryAt: 31_000 });
	});

	it('parse only counts and times', () => {
		expect(parseAttempts({ failures: 6, retryAt: 5 })).toEqual({ failures: 6, retryAt: 5 });
		expect(parseAttempts({ failures: -1, retryAt: 0 })).toBeUndefined();
		expect(parseAttempts({ failures: 1.5, retryAt: 0 })).toBeUndefined();
		expect(parseAttempts({ failures: 1, retryAt: Infinity })).toBeUndefined();
		expect(parseAttempts('x')).toBeUndefined();
	});
});
