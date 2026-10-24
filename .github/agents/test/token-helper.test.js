import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	appJwt,
	fingerprint,
	splitSecrets,
	tokenSource,
	userSource
} from '../bin/token-helper.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString());

describe('token helper', () => {
	it('signs an RS256 app JWT valid for 10 minutes from a minute ago', () => {
		const jwt = appJwt(privateKey, 'Iv1.abc', Date.UTC(2026, 9, 18));
		const [header, payload, signature] = jwt.split('.');
		expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
		const iat = Date.UTC(2026, 9, 18) / 1000 - 60;
		expect(decode(payload)).toEqual({ iat, exp: iat + 600, iss: 'Iv1.abc' });
		const valid = createVerify('RSA-SHA256')
			.update(`${header}.${payload}`)
			.verify(publicKey, signature, 'base64url');
		expect(valid).toBe(true);
	});

	it('caches a token until it has less than 10 minutes left, scoped to the repos', async () => {
		let now = Date.UTC(2026, 9, 18);
		const calls = [];
		let minted = 0;
		const request = async (path, _auth, init) => {
			calls.push([path, init?.body]);
			if (path.endsWith('/installation')) return { id: 9 };
			minted++;
			return { token: `t${minted}`, expires_at: new Date(now + 60 * 60 * 1000).toISOString() };
		};
		const source = tokenSource({
			key: privateKey,
			appId: '1',
			owner: 'xcwds',
			repos: ['xcwds', 'xcwds.github.io'],
			request,
			now: () => now
		});
		expect((await source.token()).token).toBe('t1');
		now += 49 * 60 * 1000;
		expect((await source.token()).token).toBe('t1');
		now += 2 * 60 * 1000;
		expect((await source.token()).token).toBe('t2');
		expect((await source.token({ fresh: true })).token).toBe('t3');
		expect(calls[0]).toEqual(['/users/xcwds/installation', undefined]);
		expect(calls[1]).toEqual([
			'/app/installations/9/access_tokens',
			JSON.stringify({ repositories: ['xcwds', 'xcwds.github.io'] })
		]);
		// The installation is looked up once.
		expect(calls.filter(([path]) => path.endsWith('/installation'))).toHaveLength(1);
	});

	it('fingerprints without revealing the token', () => {
		expect(fingerprint('ghs_secret')).toMatch(/^[0-9a-f]{12}$/);
		expect(fingerprint('ghs_secret')).not.toContain('secret');
	});

	it('reads the key and, after it, an optional user token from stdin', () => {
		const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).trim();
		expect(splitSecrets(`${pem}\nghu_abc\n`)).toEqual({ key: pem, userToken: 'ghu_abc' });
		expect(splitSecrets(`${pem}\n\n`)).toEqual({ key: pem, userToken: undefined });
		expect(splitSecrets('not a key')).toEqual({ key: 'not a key', userToken: undefined });
	});

	it("keeps the user token only when it's the owner's and works", async () => {
		const as = (login) => async (path, auth) => {
			expect([path, auth]).toEqual(['/user', 'ghu_abc']);
			return { login };
		};
		expect(await userSource({ token: 'ghu_abc', owner: 'xcwds', request: as('xcwds') })).toEqual({
			token: 'ghu_abc',
			login: 'xcwds'
		});
		expect(await userSource({ token: 'ghu_abc', owner: 'xcwds', request: as('someone') })).toEqual({
			reason: 'the user token belongs to someone, not xcwds'
		});
		const revoked = async () => {
			throw new Error('GitHub API GET /user: 401');
		};
		expect(await userSource({ token: 'ghu_abc', owner: 'xcwds', request: revoked })).toEqual({
			reason: "the user token doesn't work: GitHub API GET /user: 401"
		});
		expect(await userSource({ token: undefined, owner: 'xcwds' })).toEqual({
			reason: 'no user token was given'
		});
	});
});
