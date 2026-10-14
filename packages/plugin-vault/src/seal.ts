/**
 * Sealing for the vault (#79): AES-GCM-256 with a key derived from the lock's passcode by
 * PBKDF2-SHA-256. A sealed value carries its own random IV and is bound to a context (a storage
 * group's name, say) through the additional data, so a blob moved to another group won't open.
 * WebCrypto (`globalThis.crypto.subtle`) is reached only when a function runs, never at import time.
 */

export const ITERATIONS = 600_000;
/** Never fewer, so an edited blob can't make guessing cheap. */
export const MIN_ITERATIONS = 100_000;
/** Never more, so an edited blob can't freeze the page deriving a key. */
export const MAX_ITERATIONS = 10_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
/** AES-GCM's tag, the least a sealed `data` can be (an empty string seals to the tag alone). */
const TAG_BYTES = 16;
const VERSION = 1;

/** A value sealed with a vault key. Strings are base64. */
export type Sealed = { v: 1; iv: string; data: string };
/** A value sealed with the passcode itself (a backup's encrypted section), with what derives its key. */
export type PasscodeSealed = Sealed & { salt: string; iterations: number };

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** Chunked, so a large group doesn't overflow the call stack spreading bytes into arguments. */
const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
	let text = '';
	for (let i = 0; i < bytes.length; i += CHUNK)
		text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	return btoa(text);
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** How many bytes a valid base64 string decodes to. */
const byteLength = (text: string) => (text.length / 4) * 3 - (text.match(/=*$/)?.[0].length ?? 0);

const additionalData = (context: string) => new TextEncoder().encode(`xcwds-vault:v1:${context}`);

function validIterations(iterations: unknown): iterations is number {
	return (
		Number.isInteger(iterations) &&
		(iterations as number) >= MIN_ITERATIONS &&
		(iterations as number) <= MAX_ITERATIONS
	);
}

/**
 * A fresh random salt (base64) for `deriveKey`. Use a new one for the vault key: never the lock
 * verifier's, or the saved verifier would be the key itself.
 */
export function newSalt(): string {
	return toBase64(globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

/** The vault key for `passcode`: AES-GCM-256, non-extractable, so it can't be written anywhere. */
export async function deriveKey(
	passcode: string,
	salt: string,
	iterations = ITERATIONS
): Promise<CryptoKey> {
	if (!BASE64.test(salt) || byteLength(salt) < SALT_BYTES)
		throw new TypeError('The salt must be base64 of at least 16 bytes.');
	if (!validIterations(iterations))
		throw new RangeError(
			`Iterations must be a whole number from ${MIN_ITERATIONS} to ${MAX_ITERATIONS}.`
		);
	const { subtle } = globalThis.crypto;
	const base = await subtle.importKey('raw', new TextEncoder().encode(passcode), 'PBKDF2', false, [
		'deriveKey'
	]);
	return subtle.deriveKey(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt) as BufferSource, iterations },
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

/** Seals `text` with `key` for `context`, with a fresh random IV. */
export async function seal(key: CryptoKey, text: string, context: string): Promise<Sealed> {
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const data = await globalThis.crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource, additionalData: additionalData(context) },
		key,
		new TextEncoder().encode(text)
	);
	return { v: VERSION, iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

/**
 * The text `sealed` holds, or undefined when it doesn't open: a different key (a wrong passcode),
 * a different context, or data changed since it was sealed. AES-GCM can't tell these apart.
 */
export async function open(
	key: CryptoKey,
	sealed: Sealed,
	context: string
): Promise<string | undefined> {
	if (!parseSealed(sealed)) return undefined;
	try {
		const text = await globalThis.crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: fromBase64(sealed.iv) as BufferSource,
				additionalData: additionalData(context)
			},
			key,
			fromBase64(sealed.data) as BufferSource
		);
		return new TextDecoder('utf-8', { fatal: true }).decode(text);
	} catch {
		return undefined;
	}
}

/** `v` as a sealed value, or undefined when it isn't one (an older or newer format, or edited). */
export function parseSealed(v: unknown): Sealed | undefined {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
	const { v: version, iv, data } = v as Record<string, unknown>;
	if (version !== VERSION) return undefined;
	if (typeof iv !== 'string' || !BASE64.test(iv) || byteLength(iv) !== IV_BYTES) return undefined;
	if (typeof data !== 'string' || !BASE64.test(data) || byteLength(data) < TAG_BYTES)
		return undefined;
	return { v: VERSION, iv, data };
}

/** `v` as a passcode-sealed value, or undefined when it isn't one. */
export function parsePasscodeSealed(v: unknown): PasscodeSealed | undefined {
	const sealed = parseSealed(v);
	if (!sealed) return undefined;
	const { salt, iterations } = v as Record<string, unknown>;
	if (typeof salt !== 'string' || !BASE64.test(salt) || byteLength(salt) < SALT_BYTES)
		return undefined;
	if (!validIterations(iterations)) return undefined;
	return { ...sealed, salt, iterations };
}

/** Seals `text` with a key derived from `passcode` and a fresh salt (for a backup). */
export async function sealWithPasscode(
	passcode: string,
	text: string,
	context: string,
	iterations = ITERATIONS
): Promise<PasscodeSealed> {
	const salt = newSalt();
	const key = await deriveKey(passcode, salt, iterations);
	return { ...(await seal(key, text, context)), salt, iterations };
}

/** The text a passcode-sealed value holds, or undefined for a wrong passcode or changed data. */
export async function openWithPasscode(
	passcode: string,
	sealed: unknown,
	context: string
): Promise<string | undefined> {
	const parsed = parsePasscodeSealed(sealed);
	if (!parsed) return undefined;
	const key = await deriveKey(passcode, parsed.salt, parsed.iterations);
	return open(key, parsed, context);
}
