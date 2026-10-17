import { describe, expect, it } from 'vitest';
import { parseQr } from './parse.js';

describe('parseQr', () => {
	it('recognises http and https links, and nothing else as one', () => {
		expect(parseQr('https://example.com/a?b=1')).toEqual({
			kind: 'url',
			url: 'https://example.com/a?b=1'
		});
		expect(parseQr('  HTTP://Example.com ')).toEqual({ kind: 'url', url: 'http://example.com/' });
		expect(parseQr('javascript:alert(1)').kind).toBe('other');
		// A broken link is never treated as one.
		expect(parseQr('https://exa mple.com').kind).toBe('other');
		expect(parseQr('https://').kind).toBe('other');
	});

	it('reads Wi-Fi details, with escapes and in any field order', () => {
		expect(parseQr('WIFI:T:WPA;S:My\\;Cafe\\:5G;P:p\\\\a\\,ss;H:true;;')).toEqual({
			kind: 'wifi',
			wifi: { ssid: 'My;Cafe:5G', security: 'WPA', password: 'p\\a,ss', hidden: true }
		});
		expect(parseQr('wifi:S:Open;;')).toEqual({
			kind: 'wifi',
			wifi: { ssid: 'Open', security: 'nopass', password: '', hidden: false }
		});
		expect(parseQr('WIFI:T:WPA;P:secret;;').kind).toBe('other');
	});

	it('reads the name on a contact card', () => {
		expect(parseQr('BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe;Jane\r\nFN:Jane Doe\r\nEND:VCARD')).toEqual(
			{ kind: 'contact', name: 'Jane Doe' }
		);
		expect(parseQr('BEGIN:VCARD\nFN;CHARSET=UTF-8:Zoë\nEND:VCARD')).toEqual({
			kind: 'contact',
			name: 'Zoë'
		});
		expect(parseQr('MECARD:N:Doe,Jane;TEL:123;;')).toEqual({ kind: 'contact', name: 'Jane Doe' });
		expect(parseQr('BEGIN:VCARD\nEND:VCARD')).toEqual({ kind: 'contact' });
	});

	it('calls other schemes other, and anything else text', () => {
		for (const text of ['mailto:a@b.c', 'tel:+15551234', 'geo:1,2', 'otpauth://totp/x?secret=A'])
			expect(parseQr(text).kind, text).toBe('other');
		for (const text of ['Hello there', 'Note: buy milk', '12345', ''])
			expect(parseQr(text).kind, text).toBe('text');
	});
});
