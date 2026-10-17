/**
 * Sharing an app's design (#162): how it's built (its blocks, never what's saved in them) as a
 * link or a file someone opens in their own copy of the app. The link carries the design in its
 * fragment (`<path>/import#app=<data>`), which browsers never send to a server. `<data>` is the
 * definition without its id as JSON, compressed with `deflate-raw` and base64url-encoded, or,
 * where `CompressionStream` is missing, uncompressed after a `u.` prefix. Whatever comes back in
 * goes through `parseApp`, and gets a new id when it's added.
 */
import { LIMITS, newId, parseApp, type AppDefinition, type Parsed } from './format.js';

/** The longest link Share design offers; a bigger design is offered as a file only. */
export const MAX_LINK = 8 * 1024;

/** Where a file's design ends: `<name>.xcwds-app.json`. */
export const FILE_EXTENSION = '.xcwds-app.json';

/** What every link or file that can't be opened says, whatever was wrong with it. */
export const NOT_AN_APP = "This link doesn't contain an app this version can open.";
export const NOT_AN_APP_FILE = "This file doesn't contain an app this version can open.";

/** The fragment's key: `#app=<data>`. */
const KEY = 'app=';
const PLAIN = 'u.';

/** A design as shared: the definition without its id. */
export type Design = Omit<AppDefinition, 'id'>;

/** `app` without its id, the only thing that's shared. */
export function designOf(app: AppDefinition): Design {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { id, ...design } = app;
	return design;
}

const toBase64Url = (bytes: Uint8Array) => {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function fromBase64Url(text: string): Uint8Array | undefined {
	if (!/^[A-Za-z0-9_-]*$/.test(text)) return undefined;
	try {
		const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
		return Uint8Array.from(binary, (c) => c.charCodeAt(0));
	} catch {
		return undefined;
	}
}

const canCompress = () =>
	typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function pipe(bytes: Uint8Array, stream: GenericTransformStream, max: number) {
	const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.length;
		// Stops early on a small link that would inflate to something huge.
		if (size > max) {
			await reader.cancel();
			return undefined;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

/** `app`'s design as a link's `<data>` (compressed where the browser can). */
export async function encodeDesign(app: AppDefinition, compress = canCompress()): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(designOf(app)));
	if (!compress) return PLAIN + toBase64Url(bytes);
	const packed = await pipe(bytes, new CompressionStream('deflate-raw'), Infinity);
	return toBase64Url(packed!);
}

/** The design in a link's `<data>`, checked, with a new id; or why it can't be opened. */
export async function decodeDesign(data: string): Promise<Parsed<AppDefinition>> {
	const invalid = { ok: false, error: NOT_AN_APP } as const;
	// Base64 makes 4 characters of 3 bytes; nothing longer can hold a definition within limits.
	if (data.length > Math.ceil((LIMITS.bytes * 4) / 3) + 8) return invalid;
	const plain = data.startsWith(PLAIN);
	const bytes = fromBase64Url(plain ? data.slice(PLAIN.length) : data);
	if (!bytes) return invalid;
	let json = bytes;
	if (!plain) {
		if (typeof DecompressionStream !== 'function') return invalid;
		try {
			const inflated = await pipe(bytes, new DecompressionStream('deflate-raw'), LIMITS.bytes);
			if (!inflated) return invalid;
			json = inflated;
		} catch {
			return invalid;
		}
	}
	const parsed = readDesign(new TextDecoder().decode(json));
	return parsed.ok ? parsed : invalid;
}

/** A design's JSON (from a link or a file), checked, with a new id. */
function readDesign(text: string): Parsed<AppDefinition> {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { ok: false, error: "This isn't an app definition." };
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return { ok: false, error: "This isn't an app definition." };
	return parseApp({ ...value, id: newId() });
}

/** The fragment that opens a design on the import page: `#app=<data>`. */
export const designFragment = (data: string) => `#${KEY}${data}`;

/** The `<data>` in a fragment such as `location.hash`, if it has one. */
export function dataOf(hash: string): string | undefined {
	const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
	return fragment.startsWith(KEY) ? fragment.slice(KEY.length) : undefined;
}

/** A design as a file: a name made from the app's and the JSON. */
export function designFile(app: AppDefinition): { name: string; text: string } {
	const base =
		app.name
			.normalize('NFKD')
			.replace(/[^\w\s-]/g, '')
			.trim()
			.replace(/\s+/g, '-')
			.toLowerCase()
			.slice(0, 40) || 'app';
	return { name: base + FILE_EXTENSION, text: JSON.stringify(designOf(app), null, '\t') + '\n' };
}

/** The design in a file's text, checked, with a new id; or why it can't be opened. */
export function readDesignFile(text: string): Parsed<AppDefinition> {
	// Pretty-printed with tabs, a file can be a little larger than the definition it holds.
	if (new TextEncoder().encode(text).length > LIMITS.bytes * 2)
		return { ok: false, error: NOT_AN_APP_FILE };
	const parsed = readDesign(text);
	return parsed.ok ? parsed : { ok: false, error: NOT_AN_APP_FILE };
}
