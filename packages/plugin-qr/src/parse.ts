/**
 * What a scanned code holds, for showing it (#147): a link, Wi-Fi details, a contact card, other
 * text. Parsing only: nothing here opens a link or joins a network; the page decides what to do.
 */

export type QrKind = 'url' | 'wifi' | 'contact' | 'text' | 'other';

export interface WifiDetails {
	/** The network's name. */
	ssid: string;
	/** `WPA`, `WEP`, `SAE`, or `nopass` for an open network (as the code says it). */
	security: string;
	password: string;
	hidden: boolean;
}

export interface Parsed {
	kind: QrKind;
	/** For `url`: the link as `new URL()` writes it (http: or https: only). */
	url?: string;
	/** For `wifi`. */
	wifi?: WifiDetails;
	/** For `contact`: the name on the card, when it has one. */
	name?: string;
}

/** Splits `KEY:value;KEY:value;;` fields, honouring `\;`, `\,`, `\:` and `\\` escapes. */
function fields(body: string): Record<string, string> {
	const out: Record<string, string> = {};
	let key = '';
	let value = '';
	let inValue = false;
	for (let i = 0; i < body.length; i++) {
		const c = body[i]!;
		if (c === '\\' && i + 1 < body.length) {
			const next = body[++i]!;
			if (inValue) value += next;
			else key += next;
		} else if (!inValue && c === ':') inValue = true;
		else if (c === ';') {
			if (key) out[key.toUpperCase()] ??= value;
			key = value = '';
			inValue = false;
		} else if (inValue) value += c;
		else key += c;
	}
	if (key) out[key.toUpperCase()] ??= value;
	return out;
}

/** What `text`, read from a code, holds. */
export function parseQr(text: string): Parsed {
	const trimmed = text.trim();
	if (/^https?:\/\//i.test(trimmed) && !/\s/.test(trimmed)) {
		try {
			return { kind: 'url', url: new URL(trimmed).href };
		} catch {
			return { kind: 'other' };
		}
	}
	if (/^WIFI:/i.test(trimmed)) {
		const f = fields(trimmed.slice(5));
		if (f.S !== undefined)
			return {
				kind: 'wifi',
				wifi: {
					ssid: f.S,
					security: f.T || 'nopass',
					password: f.P ?? '',
					hidden: /^true$/i.test(f.H ?? '')
				}
			};
		return { kind: 'other' };
	}
	if (/^BEGIN:VCARD/i.test(trimmed)) {
		const line = /^FN(?:;[^:\r\n]*)?:(.*)$/im.exec(trimmed);
		const name = line?.[1]?.trim();
		return name ? { kind: 'contact', name } : { kind: 'contact' };
	}
	if (/^MECARD:/i.test(trimmed)) {
		const raw = fields(trimmed.slice(7)).N;
		// MECARD names are "Last,First".
		const name = raw
			?.split(',')
			.map((part) => part.trim())
			.filter(Boolean)
			.reverse()
			.join(' ');
		return name ? { kind: 'contact', name } : { kind: 'contact' };
	}
	// Another scheme (mailto:, tel:, geo:, otpauth://, a store link…): shown as text, never opened.
	if (/^[a-z][a-z0-9+.-]*:\S/i.test(trimmed)) return { kind: 'other' };
	return { kind: 'text' };
}
