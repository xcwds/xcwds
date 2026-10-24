/** The plugin's name, the @xcwds/core versions it works with, and its options. */
import { XcwdsError, codes, isOrigin } from '@xcwds/core';

export const NAME = '@xcwds/plugin-notion';
/**
 * The same range as the peer dependency (`scripts/sync-core-version.js` moves it along with
 * core's minor versions).
 */
export const CORE = '^0.5.0';

/** The options, all JSON (RFC 0001, decision 1). */
export type NotionPluginOptions = {
	/**
	 * The relay's origin (`relay/README.md`): `https://notion-relay.example.com`. Fixed at build
	 * time, since the page's content security policy allows exactly this origin.
	 */
	relay: string;
	/** The sources page's path; `/notion` by default. The copy shows at `<page>/view#<source id>`. */
	page?: string;
	/**
	 * Registers `page` itself as a route (private, titled "Notion"). Leave it off when the app
	 * lists the page some other way, as a tool in `@xcwds/plugin-tools` for instance.
	 */
	register?: boolean;
};

export type ResolvedOptions = { relay: string; page: string; register: boolean };

/** Why the plugin contacts the relay, as Settings → Privacy says it. */
export const REASON =
	'Downloads the Notion pages you choose, through a relay that adds the headers browsers need. Your token goes to Notion with each request; nothing is stored on the way.';

const KEYS = ['relay', 'page', 'register'];
const PAGE = /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

/** Checks options as written in the config, so a mistake fails the build rather than the page. */
export function resolveOptions(input: unknown): ResolvedOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const options = input as Record<string, unknown>;
	const unknown = Object.keys(options).filter((k) => !KEYS.includes(k));
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const { relay, page = '/notion', register = false } = options;
	if (relay === undefined)
		fail('`relay` is required: the origin of your Notion relay (see the relay README).');
	if (!isOrigin(relay) || !String(relay).startsWith('https:'))
		fail('`relay` must be an https: origin, such as "https://notion-relay.example.com".');
	// `xcwds add notion` writes a `.invalid` placeholder (a name that never resolves, RFC 2606).
	if (new URL(relay).hostname.endsWith('.invalid'))
		fail(
			`\`relay\` is still a placeholder (${relay}): deploy the relay (relay/README.md in ${NAME}) and set \`relay\` to its origin.`
		);
	if (typeof page !== 'string' || !PAGE.test(page))
		fail('`page` must be a path such as "/notion" (lower case letters, digits and dashes).');
	if (typeof register !== 'boolean') fail('`register` must be true or false.');
	return { relay, page, register };
}
