#!/usr/bin/env node
// Serves GitHub App installation tokens on a local Unix socket, so agent runs longer than a token's
// one-hour life keep working and the agent never sees the app's private key. When the owner's user
// access token for the app follows the key on stdin, it serves that too: the gh wrapper uses it for
// comments and new issues, which then show as the owner's, marked as made via the app.
//
// agent.yml starts it as root, before anything else, with the key on stdin (never in argv, env or a
// file), then takes sudo away from the runner user: the agent can ask for tokens but can't read this
// process's memory. Same approach as actions/create-github-app-token: a short JWT signed with the
// key, exchanged for an installation token scoped to the repos the run checked out.
//
// Usage: token-helper.mjs --socket <path> --app-id <client id> --owner <account> --repos <a,b>
// Protocol: one command per connection (`token`, `refresh`, `status`, `identity`, `user-token` or
// `user-status`), one JSON line back.

import { createHash, createPrivateKey, createSign } from 'node:crypto';
import { chmodSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const API = 'https://api.github.com';
// Hand out a new token once the cached one has less than this left, so no caller gets one that
// expires mid-push.
const MIN_LIFE_MS = 10 * 60 * 1000;

const base64url = (value) => Buffer.from(value).toString('base64url');

/** A JWT for the app itself (RS256, valid 9 minutes, backdated 1 minute for clock drift). */
export function appJwt(key, appId, now = Date.now()) {
	const iat = Math.floor(now / 1000) - 60;
	const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const payload = base64url(JSON.stringify({ iat, exp: iat + 600, iss: appId }));
	const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(key, 'base64url');
	return `${header}.${payload}.${signature}`;
}

/** A short, non-secret fingerprint of a token, for logs and the smoke test. */
export const fingerprint = (token) => createHash('sha256').update(token).digest('hex').slice(0, 12);

async function api(path, auth, init = {}) {
	const response = await fetch(`${API}${path}`, {
		...init,
		headers: {
			accept: 'application/vnd.github+json',
			authorization: `Bearer ${auth}`,
			'x-github-api-version': '2022-11-28',
			'user-agent': 'xcwds-agent-token-helper',
			...(init.body ? { 'content-type': 'application/json' } : {})
		}
	});
	if (!response.ok) {
		throw new Error(`GitHub API ${init.method ?? 'GET'} ${path}: ${response.status}`);
	}
	return response.json();
}

/** Mints and caches installation tokens for one app installation. */
export function tokenSource({ key, appId, owner, repos, request = api, now = Date.now }) {
	let installation;
	let cached;
	let identity;

	async function mint() {
		const jwt = appJwt(key, appId, now());
		installation ??= (await request(`/users/${owner}/installation`, jwt)).id;
		const { token, expires_at } = await request(
			`/app/installations/${installation}/access_tokens`,
			jwt,
			{ method: 'POST', body: JSON.stringify({ repositories: repos }) }
		);
		cached = { token, expires: Date.parse(expires_at) };
		return cached;
	}

	return {
		async token({ fresh = false } = {}) {
			if (fresh || !cached || cached.expires - now() < MIN_LIFE_MS) await mint();
			return cached;
		},
		async identity() {
			if (!identity) {
				const { slug } = await request('/app', appJwt(key, appId, now()));
				const login = `${slug}[bot]`;
				const { token } = await this.token();
				const { id } = await request(`/users/${encodeURIComponent(login)}`, token);
				identity = { slug, login, id };
			}
			return identity;
		}
	};
}

/** The private key and, after it, the owner's user access token if there is one. */
export function splitSecrets(input) {
	const end = /-----END [A-Z ]+-----/.exec(input);
	if (!end) return { key: input, userToken: undefined };
	const at = end.index + end[0].length;
	return { key: input.slice(0, at), userToken: input.slice(at).trim() || undefined };
}

/**
 * The owner's user access token, kept only if it really is the owner's. A token that fails the
 * check (revoked, or someone else's) is dropped with the reason, and the agent stays the bot.
 */
export async function userSource({ token, owner, request = api }) {
	if (!token) return { reason: 'no user token was given' };
	try {
		const { login } = await request('/user', token);
		if (login !== owner) return { reason: `the user token belongs to ${login}, not ${owner}` };
		return { token, login };
	} catch (error) {
		return { reason: `the user token doesn't work: ${error.message}` };
	}
}

async function handle(source, user, command) {
	switch (command) {
		case 'token':
			return { token: (await source.token()).token };
		case 'refresh':
		case 'status': {
			const { token, expires } = await source.token({ fresh: command === 'refresh' });
			return { fingerprint: fingerprint(token), expires_at: new Date(expires).toISOString() };
		}
		case 'identity':
			return source.identity();
		case 'user-token':
			if (!user.token) throw new Error(`no user token: ${user.reason}`);
			return { token: user.token };
		case 'user-status':
			return user.token
				? { login: user.login, fingerprint: fingerprint(user.token) }
				: { login: null, reason: user.reason };
		default:
			throw new Error(`unknown command: ${command}`);
	}
}

async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString('utf8');
}

async function main() {
	const { values } = parseArgs({
		options: {
			socket: { type: 'string' },
			'app-id': { type: 'string' },
			owner: { type: 'string' },
			repos: { type: 'string' }
		}
	});
	const { socket, 'app-id': appId, owner, repos } = values;
	if (!socket || !appId || !owner || !repos) {
		throw new Error(
			'usage: token-helper.mjs --socket <path> --app-id <id> --owner <owner> --repos <a,b>'
		);
	}
	const secrets = splitSecrets(await readStdin());
	// The key lives only in this KeyObject from here on.
	const key = createPrivateKey(secrets.key);
	const source = tokenSource({ key, appId, owner, repos: repos.split(',').filter(Boolean) });
	// Fail fast, before the workflow goes on, when the app or its installation is misconfigured.
	await source.token();
	const user = await userSource({ token: secrets.userToken, owner });
	console.log(user.token ? `user token for ${user.login}` : `no user token: ${user.reason}`);

	rmSync(socket, { force: true });
	const server = createServer((connection) => {
		let input = '';
		connection.setEncoding('utf8');
		connection.on('data', async (chunk) => {
			input += chunk;
			if (!input.includes('\n')) return;
			const command = input.trim();
			try {
				connection.end(JSON.stringify(await handle(source, user, command)) + '\n');
			} catch (error) {
				connection.end(JSON.stringify({ error: error.message }) + '\n');
			}
		});
		connection.on('error', () => {});
	});
	server.listen(socket, () => {
		// The runner user (not root) runs the agent and asks for tokens.
		chmodSync(socket, 0o666);
		console.log(`token helper listening on ${socket}`);
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(`token helper: ${error.message}`);
		process.exit(1);
	});
}
