// @xcwds/plugin-notion (#106, #107) in the base-path build, which sets a relay (NOTION_RELAY in
// `build:base`): /utils/notion is `<NotionSources>`, which connects, adds each kind of source and
// downloads it through the relay, mocked here with route interception; each copy opens at
// /utils/notion/view (`<NotionView>`). The token never reaches a URL or a backup. Images Notion
// hosts come through the relay's `/file` and stay on the device (#108).
import {
	expect,
	test,
	type BrowserContext,
	type Locator,
	type Page,
	type Route
} from '@playwright/test';
import {
	auditTapTargets,
	gotoHydrated,
	serveStatic,
	waitForServiceWorker,
	type StaticServer
} from '@xcwds/testing/playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const build = fileURLToPath(new URL('../build-sub', import.meta.url));
let server: StaticServer;
const url = (path: string) => server.url(path);

test.beforeAll(async () => {
	server = await serveStatic(build, { base: '/sub' });
});
test.afterAll(() => server.close());

const RELAY = 'https://notion-relay.example';
const TOKEN = 'ntn_good_token_1234';
const OFFLINE = "Couldn't reach Notion. Check the connection.";
const PAGE = '0c940186-ab70-4351-bb34-2d16f0635d49';
const PARENT = '11111111-2222-4333-8444-555555555555';
const DS = '59833787-2cf9-4fdf-8782-e53db20768a5';
const DB = '66666666-2222-4333-8444-555555555555';
/** A database with two data sources, so adding it asks which one. */
const DB_TWO = '77777777-2222-4333-8444-555555555555';
const DS_OTHER = '88888888-2222-4333-8444-555555555555';
const OLD_CHILD = '22222222-2222-4333-8444-555555555555';
const NEW_CHILD = '33333333-2222-4333-8444-555555555555';
const NEWEST = '44444444-2222-4333-8444-555555555555';

/** A 1×1 PNG, and the signed link Notion gives for it on the "Reading list" page. */
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64'
);
const IMAGE =
	'https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/f/cat.png?X-Amz-Signature=abc';
const EXTERNAL = 'https://images.example/elsewhere.png';

const TITLES: Record<string, string> = {
	[PAGE]: 'Reading list',
	[NEW_CHILD]: 'Thursday notes',
	[NEWEST]: 'Agenda for today'
};

const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-headers': 'authorization, notion-version, content-type',
	'access-control-allow-methods': 'GET, POST'
};

/**
 * `hold`, while set, delays answers about databases until it settles. `files` records the
 * headers each `/file` request came with.
 */
type Relay = {
	urls: string[];
	down: boolean;
	hold?: Promise<void>;
	files: Record<string, string>[];
};

/** A relay that answers like Notion for the pages above, and fails while `down`. */
async function mockRelay(context: BrowserContext): Promise<Relay> {
	const relay: Relay = { urls: [], down: false, files: [] };
	await context.route(`${RELAY}/**`, async (route: Route) => {
		const request = route.request();
		if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
		relay.urls.push(request.url());
		if (relay.down) return route.abort('internetdisconnected');
		const json = (body: unknown, status = 200) =>
			route.fulfill({
				status,
				headers: CORS,
				contentType: 'application/json',
				body: JSON.stringify(body)
			});
		const target = new URL(request.url());
		if (target.pathname === '/file') {
			relay.files.push(request.headers());
			return target.searchParams.get('url') === IMAGE
				? route.fulfill({ status: 200, headers: CORS, contentType: 'image/png', body: PNG })
				: route.fulfill({ status: 403, headers: CORS });
		}
		if (request.headers()['authorization'] !== `Bearer ${TOKEN}`)
			return json({ object: 'error', code: 'unauthorized', message: 'API token is invalid.' }, 401);
		const path = new URL(request.url()).pathname;
		if (path.startsWith('/v1/databases/')) await relay.hold;
		const list = (results: unknown[]) => json({ results, has_more: false, next_cursor: null });
		if (path === '/v1/users/me') return json({ object: 'user', id: 'bot', name: 'Agenda reader' });
		if (path === `/v1/databases/${DB}`)
			return json({ object: 'database', id: DB, data_sources: [{ id: DS, name: 'Agenda' }] });
		if (path === `/v1/databases/${DB_TWO}`)
			return json({
				object: 'database',
				id: DB_TWO,
				data_sources: [
					{ id: DS_OTHER, name: 'Archive' },
					{ id: DS, name: 'Agenda' }
				]
			});
		if (path === `/v1/data_sources/${DS_OTHER}/query`) return list([]);
		if (path === `/v1/data_sources/${DS}/query`) return list([{ object: 'page', id: NEWEST }]);
		if (path === `/v1/blocks/${PARENT}/children`)
			return list([
				{ object: 'block', id: OLD_CHILD, type: 'child_page', child_page: { title: 'Wednesday' } },
				{ object: 'block', id: NEW_CHILD, type: 'child_page', child_page: { title: 'Thursday' } }
			]);
		const page = /^\/v1\/pages\/(.+)$/.exec(path)?.[1];
		if (page && TITLES[page])
			return json({
				object: 'page',
				id: page,
				// The newest agenda is from today; the other pages are older.
				created_time: page === NEWEST ? new Date().toISOString() : '2026-10-22T06:00:00.000Z',
				properties: { Name: { type: 'title', title: [{ plain_text: TITLES[page] }] } }
			});
		const blocks = /^\/v1\/blocks\/(.+)\/children$/.exec(path)?.[1];
		if (blocks && TITLES[blocks])
			return list([
				{
					object: 'block',
					id: `${blocks.slice(0, -4)}aaaa`,
					type: 'paragraph',
					has_children: false,
					paragraph: {
						rich_text: [
							{ plain_text: `Inside ${TITLES[blocks]}, ` },
							{ plain_text: 'a link', href: 'https://example.org/read' },
							{ plain_text: ' and ' },
							{ plain_text: 'a script', href: 'javascript:alert(1)' }
						]
					}
				},
				{
					object: 'block',
					id: `${blocks.slice(0, -4)}bbbb`,
					type: 'to_do',
					has_children: false,
					to_do: { rich_text: [{ plain_text: 'Buy milk' }], checked: true }
				},
				{
					object: 'block',
					id: `${blocks.slice(0, -4)}cccc`,
					type: 'bookmark',
					has_children: false,
					bookmark: { url: 'https://example.org/bookmarked', caption: [] }
				},
				...(blocks === PAGE
					? [
							{
								object: 'block',
								id: `${blocks.slice(0, -4)}dddd`,
								type: 'image',
								has_children: false,
								image: {
									type: 'file',
									file: { url: IMAGE, expiry_time: new Date().toISOString() },
									caption: [{ plain_text: 'The cat' }]
								}
							},
							{
								object: 'block',
								id: `${blocks.slice(0, -4)}eeee`,
								type: 'image',
								has_children: false,
								image: { type: 'external', external: { url: EXTERNAL }, caption: [] }
							}
						]
					: [])
			]);
		return json({ object: 'error', code: 'object_not_found' }, 404);
	});
	return relay;
}

/** The cat image shows, read from the device (an object URL) and decoded. */
async function expectImage(scope: Locator) {
	const image = scope.getByRole('img', { name: 'The cat' });
	await expect(image).toBeVisible();
	await expect(image).toHaveAttribute('src', /^blob:/);
	await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
}

const sources = (page: Page) => page.getByRole('list', { name: 'Sources' }).getByTestId('source');
const source = (page: Page, label: string) =>
	sources(page).filter({ has: page.getByTestId('source-label').getByText(label, { exact: true }) });

async function connect(page: Page, token: string) {
	await page.getByLabel('Integration token').fill(token);
	await page.getByRole('button', { name: 'Test connection' }).click();
}

const KINDS = {
	page: 'One page',
	database: 'Newest page in a database',
	child: 'Newest child page'
} as const;

async function addSource(page: Page, kind: keyof typeof KINDS, label: string, link: string) {
	await page.getByLabel('Kind').selectOption({ label: KINDS[kind] });
	await page.getByLabel('Label', { exact: true }).fill(label);
	await page.getByLabel(/ link or id/).fill(link);
	await page.getByRole('button', { name: 'Add', exact: true }).click();
}

/** Opens a source's copy on its own page, from the sources list. */
async function openCopy(page: Page, label: string) {
	await source(page, label).getByTestId('source-label').click();
	await expect(page).toHaveURL(/\/utils\/notion\/view#/);
	return page.getByTestId('notion-view');
}

async function backToSources(page: Page) {
	await page.locator('header [data-shell-back]').click();
	await expect(page).toHaveURL(url('/utils/notion'));
}

test.use({ viewport: { width: 390, height: 844 } });

test('connects, downloads each kind of source, keeps copies when the relay fails, and disconnects', async ({
	page,
	context
}) => {
	const relay = await mockRelay(context);
	const elsewhere: string[] = [];
	page.on('request', (request) => {
		if (new URL(request.url()).host === new URL(EXTERNAL).host) elsewhere.push(request.url());
	});
	await gotoHydrated(page, url('/utils/notion'));
	await expect(page.getByRole('heading', { level: 1, name: 'Notion' })).toBeVisible();

	// A token Notion refuses isn't saved.
	await connect(page, 'ntn_wrong_token_99');
	await expect(page.getByTestId('connect-note')).toHaveText(
		'Notion refused the token. Connect again with a valid token.'
	);
	await expect(page.getByTestId('notion-connected')).toHaveCount(0);
	expect(await page.evaluate(() => localStorage.getItem('app:notion:token'))).toBeNull();

	await connect(page, TOKEN);
	await expect(page.getByTestId('connect-note')).toHaveText('Connected as Agenda reader.');
	await expect(page.getByTestId('notion-connected')).toBeVisible();
	await expect(page.getByTestId('no-sources')).toHaveText('No sources yet.');

	// One page, by link.
	await addSource(
		page,
		'page',
		'Reading',
		`https://www.notion.so/Reading-list-${PAGE.replace(/-/g, '')}`
	);
	await expect(source(page, 'Reading').getByTestId('source-status')).toHaveText(/^Downloaded /);
	await expect(page.getByTestId('no-sources')).toHaveCount(0);
	// The newest child page: the last one Notion lists.
	await addSource(page, 'child', 'Journal', PARENT);
	await expect(source(page, 'Journal').getByTestId('source-status')).toHaveText(/^Downloaded /);
	// The newest page of a database with one data source, which is taken without asking.
	await addSource(page, 'database', 'Agenda', DB);
	await expect(source(page, 'Agenda').getByTestId('source-status')).toHaveText(/^Downloaded /);
	await expect(sources(page)).toHaveCount(3);
	expect(relay.urls).toContainEqual(`${RELAY}/v1/data_sources/${DS}/query`);
	expect(await auditTapTargets(page)).toEqual([]);

	// Each copy opens on its own page, drawn by `<NotionDocument>`.
	let copy = await openCopy(page, 'Reading');
	await expect(copy.getByRole('heading', { level: 2, name: 'Reading list' })).toBeVisible();
	await expect(copy.getByRole('link', { name: 'a link' })).toHaveAttribute(
		'href',
		'https://example.org/read'
	);
	// A link Notion sent with an unsafe scheme keeps only its text.
	await expect(copy.getByText('a script')).toBeVisible();
	await expect(copy.getByRole('link', { name: 'a script' })).toHaveCount(0);
	await expect(copy.getByRole('checkbox', { name: 'Buy milk' })).toBeChecked();
	await expect(copy.getByRole('checkbox', { name: 'Buy milk' })).toBeDisabled();
	// The image Notion hosts came through the relay without the token, and shows from the device;
	// the one from another site is only a link.
	await expectImage(copy);
	expect(relay.files).toHaveLength(1);
	expect(relay.files[0]!['authorization']).toBeUndefined();
	await expect(copy.getByRole('link', { name: 'Open it on images.example' })).toHaveAttribute(
		'href',
		EXTERNAL
	);
	expect(elsewhere).toEqual([]);
	await backToSources(page);
	copy = await openCopy(page, 'Journal');
	await expect(copy).toContainText('Inside Thursday notes');
	await backToSources(page);
	copy = await openCopy(page, 'Agenda');
	await expect(copy).toContainText('Agenda for today');
	await backToSources(page);

	// The relay goes away: a reload still lists every copy, and a failed refresh keeps it.
	relay.down = true;
	await gotoHydrated(page, url('/utils/notion'));
	await expect(sources(page)).toHaveCount(3);
	await expect(source(page, 'Agenda').getByTestId('source-status')).toHaveText(/^Downloaded /);
	await source(page, 'Agenda').getByRole('button', { name: 'Refresh' }).click();
	await expect(source(page, 'Agenda').getByTestId('source-status')).toHaveText(OFFLINE);
	await expect(await openCopy(page, 'Agenda')).toContainText('Agenda for today');
	await backToSources(page);
	relay.down = false;

	// Removing asks first, then removes the source and its copy.
	await source(page, 'Reading').getByRole('button', { name: 'Remove…' }).click();
	await source(page, 'Reading').getByRole('button', { name: 'Cancel' }).click();
	await expect(sources(page)).toHaveCount(3);
	await source(page, 'Reading').getByRole('button', { name: 'Remove…' }).click();
	await source(page, 'Reading').getByRole('button', { name: 'Remove Reading' }).click();
	await expect(sources(page)).toHaveCount(2);
	const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('app:notion:copies')!));
	expect(Object.keys(saved)).toHaveLength(2);

	// The token only ever went in a header.
	for (const target of relay.urls) expect(target).not.toContain(TOKEN);

	// Disconnecting asks first, then removes the token and every copy, and keeps the sources.
	await page.getByRole('button', { name: 'Disconnect…' }).click();
	await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
	await expect(page.getByLabel('Integration token')).toBeVisible();
	await expect(sources(page)).toHaveCount(2);
	await expect(source(page, 'Agenda').getByTestId('source-status')).toHaveText(
		'Not downloaded yet.'
	);
	await expect(source(page, 'Agenda').getByRole('button', { name: 'Refresh' })).toBeDisabled();
	expect(
		await page.evaluate(() => [
			localStorage.getItem('app:notion:token'),
			localStorage.getItem('app:notion:copies')
		])
	).toEqual([null, null]);
});

test('a database with several data sources asks which one to read', async ({ page, context }) => {
	const relay = await mockRelay(context);
	await gotoHydrated(page, url('/utils/notion'));
	await connect(page, TOKEN);
	await expect(page.getByTestId('notion-connected')).toBeVisible();

	// A link that isn't Notion's, and a missing label, are caught before anything is sent.
	await addSource(page, 'database', 'Agenda', 'not a link');
	await expect(page.getByTestId('source-note')).toHaveText('That isn’t a Notion link or id.');
	await addSource(page, 'database', ' ', DB_TWO);
	await expect(page.getByTestId('source-note')).toHaveText('Give the source a label.');
	expect(relay.urls.filter((u) => u.includes('/v1/databases/'))).toEqual([]);

	// An answer that arrives after the link changed is dropped, not offered for the new link.
	let release!: () => void;
	relay.hold = new Promise((resolve) => (release = resolve));
	await addSource(page, 'database', 'Agenda', DB_TWO);
	await expect(page.getByRole('button', { name: 'Checking…' })).toBeVisible();
	await page.getByLabel(/ link or id/).fill(DB);
	release();
	await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
	await expect(page.getByLabel('Data source')).toHaveCount(0);
	await expect(page.getByTestId('source-note')).toBeEmpty();
	await expect(page.getByTestId('no-sources')).toBeVisible();
	relay.hold = undefined;

	await page.getByLabel(/ link or id/).fill(DB_TWO);
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByTestId('source-note')).toHaveText(
		'This database has several data sources. Choose one, then Add again.'
	);
	await expect(page.getByTestId('no-sources')).toBeVisible();
	const choice = page.getByLabel('Data source');
	await expect(choice.locator('option')).toHaveText(['Archive', 'Agenda']);
	await choice.selectOption({ label: 'Agenda' });
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(source(page, 'Agenda').getByTestId('source-status')).toHaveText(/^Downloaded /);
	expect(relay.urls).toContainEqual(`${RELAY}/v1/data_sources/${DS}/query`);
	expect(relay.urls).not.toContainEqual(`${RELAY}/v1/data_sources/${DS_OTHER}/query`);
	// The form is cleared, and with it the choice.
	await expect(page.getByLabel('Data source')).toHaveCount(0);
	await expect(page.getByTestId('source-note')).toBeEmpty();
});

test('a backup carries the sources but never the token or the copies', async ({
	page,
	context
}) => {
	await mockRelay(context);
	await gotoHydrated(page, url('/utils/notion'));
	await connect(page, TOKEN);
	await expect(page.getByTestId('notion-connected')).toBeVisible();
	await addSource(page, 'page', 'Reading', PAGE);
	await expect(source(page, 'Reading').getByTestId('source-status')).toHaveText(/^Downloaded /);

	await gotoHydrated(page, url('/settings'));
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download backup' }).click();
	const backup = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
	expect(backup.data['app:notion:sources']).toMatchObject([{ label: 'Reading', page: PAGE }]);
	expect(Object.keys(backup.data)).not.toContain('app:notion:token');
	expect(Object.keys(backup.data)).not.toContain('app:notion:copies');
	expect(JSON.stringify(backup)).not.toContain(TOKEN);
	// The refresh setting has its own section.
	await expect(page.getByRole('heading', { name: 'Notion' })).toBeVisible();
	const more = page.getByRole('button', { name: 'More Download Notion pages again after' });
	await expect(more.locator('xpath=preceding-sibling::output')).toHaveText('30 min');
});

test.describe('with the service worker', () => {
	test.use({ serviceWorkers: 'allow' });

	test('offline, the saved copy still shows', async ({ page, context }) => {
		const relay = await mockRelay(context);
		await gotoHydrated(page, url('/utils/notion'));
		await waitForServiceWorker(page);
		await connect(page, TOKEN);
		await expect(page.getByTestId('notion-connected')).toBeVisible();
		await addSource(page, 'page', 'Reading', PAGE);
		await expect(source(page, 'Reading').getByTestId('source-status')).toHaveText(/^Downloaded /);

		// Route interception still answers while offline, so the relay goes down with the network.
		relay.down = true;
		await context.setOffline(true);
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
		await expect(source(page, 'Reading').getByTestId('source-status')).toHaveText(/^Downloaded /);
		await source(page, 'Reading').getByRole('button', { name: 'Refresh' }).click();
		await expect(source(page, 'Reading').getByTestId('source-status')).toHaveText(OFFLINE);

		// The page for one copy opens offline too, from the worker's cache.
		await source(page, 'Reading').getByTestId('source-label').click();
		await expect(page.getByRole('heading', { level: 2, name: 'Reading list' })).toBeVisible();
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
		await expect(page.getByTestId('notion-view')).toContainText('Inside Reading list');
		await expect(page.getByTestId('notion-view-status')).toHaveText(/^Downloaded /);
		// Its image too, from the device.
		await expectImage(page.getByTestId('notion-view'));
		await context.setOffline(false);
	});
});

const SIZES = { phone: { width: 390, height: 844 }, computer: { width: 1280, height: 800 } };

for (const [size, viewport] of Object.entries(SIZES)) {
	test(`one copy opens on its own page on a ${size}, its id in the fragment`, async ({
		page,
		context
	}) => {
		const relay = await mockRelay(context);
		await page.setViewportSize(viewport);
		await gotoHydrated(page, url('/utils/notion'));
		await connect(page, TOKEN);
		await expect(page.getByTestId('notion-connected')).toBeVisible();
		await addSource(page, 'child', 'Journal', PARENT);
		await expect(source(page, 'Journal').getByTestId('source-status')).toHaveText(/^Downloaded /);
		await addSource(page, 'database', 'Agenda', DB);
		await expect(source(page, 'Agenda').getByTestId('source-status')).toHaveText(/^Downloaded /);

		const link = source(page, 'Journal').getByTestId('source-label');
		const id = (await link.getAttribute('href'))!.split('#')[1]!;
		// Its copy has gone stale (older than the 30-minute setting): opening it downloads it again.
		await page.evaluate((id) => {
			const copies = JSON.parse(localStorage.getItem('app:notion:copies')!);
			copies[id].fetchedAt = Date.now() - 60 * 60_000;
			localStorage.setItem('app:notion:copies', JSON.stringify(copies));
		}, id);
		const before = relay.urls.length;
		await link.click();
		await expect
			.poll(() => relay.urls.slice(before))
			.toContainEqual(`${RELAY}/v1/blocks/${PARENT}/children?page_size=100`);
		await expect(page).toHaveURL(`${url('/utils/notion/view')}#${id}`);
		expect(new URL(page.url()).search).toBe('');
		await expect(page.getByRole('heading', { level: 1, name: 'Notion page' })).toBeVisible();
		const view = page.getByTestId('notion-view');
		await expect(view.getByRole('heading', { level: 2, name: 'Thursday notes' })).toBeVisible();
		await expect(view.getByRole('checkbox', { name: 'Buy milk' })).toBeChecked();
		await expect(page.getByTestId('notion-view-status')).toHaveText(/^Downloaded /);
		// Yesterday's page isn't taken for today's.
		await expect(page.getByTestId('notion-view-old')).toContainText(
			'No newer page yet: this one is from'
		);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
		expect(await auditTapTargets(page)).toEqual([]);

		// The back arrow goes to the sources page.
		await page.locator('header [data-shell-back]').click();
		await expect(page).toHaveURL(url('/utils/notion'));
		await source(page, 'Agenda').getByTestId('source-label').click();
		await expect(page.getByTestId('notion-view')).toContainText('Agenda for today');
		await expect(page.getByTestId('notion-view-old')).toHaveCount(0);

		// A failed refresh keeps the copy and says why.
		relay.down = true;
		await page.getByRole('button', { name: 'Refresh' }).click();
		await expect(page.getByTestId('notion-view-status')).toHaveText(OFFLINE);
		await expect(page.getByTestId('notion-view')).toContainText('Agenda for today');

		// An id that isn't on this device says so.
		await gotoHydrated(page, `${url('/utils/notion/view')}#nope`);
		await expect(page.getByTestId('notion-view-missing')).toBeVisible();
	});
}
