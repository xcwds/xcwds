#!/usr/bin/env node
// Asks the token helper (token-helper.mjs) for a GitHub token, on the socket in AGENT_TOKEN_SOCKET.
//
//   agent-token            prints a token with at least 10 minutes left
//   agent-token status     prints the current token's fingerprint and expiry (no secret)
//   agent-token refresh    mints a new token and prints its fingerprint and expiry (no secret)
//   agent-token identity   prints the app's bot login and user id

import { connect } from 'node:net';

const command = process.argv[2] ?? 'token';
const socket = process.env.AGENT_TOKEN_SOCKET;
if (!socket) {
	console.error('agent-token: AGENT_TOKEN_SOCKET is not set');
	process.exit(1);
}

const connection = connect(socket, () => connection.write(`${command}\n`));
let output = '';
connection.setEncoding('utf8');
connection.on('data', (chunk) => (output += chunk));
connection.on('error', (error) => {
	console.error(`agent-token: ${error.message}`);
	process.exit(1);
});
connection.on('end', () => {
	const reply = JSON.parse(output);
	if (reply.error) {
		console.error(`agent-token: ${reply.error}`);
		process.exit(1);
	}
	console.log(command === 'token' ? reply.token : JSON.stringify(reply));
});
