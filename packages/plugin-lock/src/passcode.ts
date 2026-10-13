/**
 * The passcode, kept as a verifier and never itself (#76): PBKDF2-SHA-256 with a random salt,
 * compared in constant time. Also the passcode rules and the wait after wrong tries. WebCrypto
 * (`globalThis.crypto.subtle`) is reached only when a function runs, never at import time.
 */

/** Digits need at least 6, a passphrase at least 8 characters (#70's decisions). */
export const MIN_DIGITS = 6;
export const MIN_PASSPHRASE = 8;
/** Long enough for any passphrase; a cap keeps hashing a pasted novel from freezing the page. */
export const MAX_PASSCODE = 256;
export const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

export type PasscodeKind = 'digits' | 'passphrase';

/** What's wrong with a new passcode, as a sentence to show, or undefined when it's fine. */
export function passcodeProblem(code: string, kind: PasscodeKind): string | undefined {
	if (code.length > MAX_PASSCODE) return `Use at most ${MAX_PASSCODE} characters.`;
	if (kind === 'digits') {
		if (!/^\d*$/.test(code)) return 'Use digits only, or switch to a passphrase.';
		if (code.length < MIN_DIGITS) return `Use at least ${MIN_DIGITS} digits.`;
		return undefined;
	}
	if (code.trim() === '') return 'Type a passphrase.';
	if ([...code].length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters.`;
	return undefined;
}

/** What's saved instead of the passcode. */
export type Verifier = {
	kind: PasscodeKind;
	/** Base64. */
	salt: string;
	iterations: number;
	/** Base64 of the PBKDF2-SHA-256 output. */
	hash: string;
};

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function parseVerifier(v: unknown): Verifier | undefined {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
	const { kind, salt, iterations, hash } = v as Record<string, unknown>;
	if (kind !== 'digits' && kind !== 'passphrase') return undefined;
	if (typeof salt !== 'string' || !BASE64.test(salt)) return undefined;
	if (typeof hash !== 'string' || !BASE64.test(hash)) return undefined;
	// Never fewer than a fixed floor, so an edited verifier can't make guessing cheap.
	if (!Number.isInteger(iterations) || (iterations as number) < 100_000) return undefined;
	return { kind, salt, iterations: iterations as number, hash };
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(code: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
	const { subtle } = globalThis.crypto;
	const key = await subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, [
		'deriveBits'
	]);
	const bits = await subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
		key,
		HASH_BITS
	);
	return new Uint8Array(bits);
}

/** A verifier for `code`, with a fresh random salt. */
export async function createVerifier(
	code: string,
	kind: PasscodeKind,
	iterations = ITERATIONS
): Promise<Verifier> {
	const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = await derive(code, salt, iterations);
	return { kind, salt: toBase64(salt), iterations, hash: toBase64(hash) };
}

/** Compares every byte whatever it finds, so timing doesn't say how much matched. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	let diff = a.length ^ b.length;
	for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
}

/** Whether `code` is the passcode `verifier` was made from. */
export async function verify(code: string, verifier: Verifier): Promise<boolean> {
	if (code.length > MAX_PASSCODE) return false;
	const hash = await derive(code, fromBase64(verifier.salt), verifier.iterations);
	return sameBytes(hash, fromBase64(verifier.hash));
}

/** Wrong tries so far, and when the next try is allowed (ms since the epoch; 0 = now). */
export type Attempts = { failures: number; retryAt: number };

export const NO_ATTEMPTS: Attempts = { failures: 0, retryAt: 0 };

export function parseAttempts(v: unknown): Attempts | undefined {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
	const { failures, retryAt } = v as Record<string, unknown>;
	if (!Number.isInteger(failures) || (failures as number) < 0) return undefined;
	if (typeof retryAt !== 'number' || !Number.isFinite(retryAt) || retryAt < 0) return undefined;
	return { failures: failures as number, retryAt };
}

/** Free tries before the waits start. */
export const FREE_TRIES = 5;
/** The waits after each further wrong try: 30 s, 1 min, 5 min, 15 min, then an hour each. */
export const WAITS = [30_000, 60_000, 300_000, 900_000, 3_600_000] as const;

/** How long to wait after the `failures`th wrong try. */
export function waitAfter(failures: number): number {
	if (failures < FREE_TRIES) return 0;
	return WAITS[Math.min(failures - FREE_TRIES, WAITS.length - 1)]!;
}

/** `attempts` after one more wrong try at `now`. */
export function failed(attempts: Attempts, now: number): Attempts {
	const failures = attempts.failures + 1;
	const wait = waitAfter(failures);
	return { failures, retryAt: wait ? now + wait : 0 };
}
