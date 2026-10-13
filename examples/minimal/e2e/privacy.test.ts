// "Never phone home" (#22): the app makes no off-origin requests, its CSP blocks URLs built at
// runtime (on prerendered pages and the 404.html fallback), and Settings says so.
import { expect, test, type Page } from '@playwright/test';
import { gotoHydrated, serveStatic, type StaticServer } from '@xcwds/testing/playwright';
import { fileURLToPath } from 'node:url';

const build = fileURLToPath(new URL('../build', import.meta.url));
let server: StaticServer;
const url = (path: string) => server.url(path);

test.beforeAll(async () => {
	server = await serveStatic(build);
});
test.afterAll(() => server.close());

const PAGES = [
	'/',
	'/hello',
	'/utils',
	'/utils/coffee',
	'/utils/notes',
	'/utils/timer',
	'/utils/dice',
	'/utils/units',
	'/utils/journal',
	'/inbox',
	'/settings'
];

test.describe('with the service worker', () => {
	test.use({ serviceWorkers: 'allow' });

	test('no page makes a request off the app origin', async ({ page, context }) => {
		const origin = new URL(url('/')).origin;
		const away: string[] = [];
		context.on('request', (request) => {
			const target = new URL(request.url());
			if (!['data:', 'blob:'].includes(target.protocol) && target.origin !== origin)
				away.push(request.url());
		});
		for (const path of PAGES) {
			await gotoHydrated(page, url(path));
			// Give boot hooks and the worker's precache time to run.
			await page.waitForLoadState('networkidle');
		}
		await gotoHydrated(page, url('/no-such-page'));
		await page.waitForLoadState('networkidle');
		expect(away).toEqual([]);
	});

	test('the service worker can’t contact an undeclared origin either (#55)', async ({
		page,
		context
	}) => {
		let reached = 0;
		await context.route('https://example.com/**', (route) => {
			reached++;
			return route.fulfill({ body: 'reached' });
		});
		const registered = context.waitForEvent('serviceworker');
		await gotoHydrated(page, url('/'));
		const worker = context.serviceWorkers()[0] ?? (await registered);
		const result = await worker.evaluate(async () => {
			const attempt = (run: () => Promise<unknown>) =>
				run().then(
					() => 'sent',
					(error: unknown) => String(error)
				);
			// Built at runtime, so no static scan could have seen it.
			const host = ['example', 'com'].join('.');
			return {
				own: await attempt(() => fetch('/')),
				fetched: await attempt(() => fetch(`https://${host}/collect?x=1`)),
				cached: await attempt(async () =>
					(await caches.open('guard-test')).add(`https://${host}/pixel.gif`)
				)
			};
		});
		expect(result.own).toBe('sent');
		expect(result.fetched).toMatch(/blocked a request to https:\/\/example\.com/);
		expect(result.cached).toMatch(/blocked a request to https:\/\/example\.com/);
		expect(reached).toBe(0);
	});
});

/** Asks the page for a URL built at runtime; resolves to what the CSP did. */
function tryToPhoneHome(page: Page) {
	return page.evaluate(async () => {
		const blocked: string[] = [];
		document.addEventListener('securitypolicyviolation', (e) =>
			blocked.push(`${e.effectiveDirective} ${e.blockedURI}`)
		);
		// Built at runtime, so no static scan could have seen it.
		const host = ['example', 'com'].join('.');
		const fetched = await fetch(`https://${host}/collect?x=1`).then(
			() => 'sent',
			() => 'failed'
		);
		const image = await new Promise<string>((resolve) => {
			const img = new Image();
			img.onload = () => resolve('loaded');
			img.onerror = () => resolve('failed');
			img.src = `https://${host}/pixel.gif`;
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		return { fetched, image, blocked };
	});
}

for (const path of ['/', '/no-such-page']) {
	test(`the CSP blocks a runtime-built URL to an undeclared origin on ${path}`, async ({
		page
	}) => {
		let reached = 0;
		await page.route('https://example.com/**', (route) => {
			reached++;
			return route.fulfill({ status: 200, body: 'ok' });
		});
		await gotoHydrated(page, url(path));
		const result = await tryToPhoneHome(page);
		expect(result.fetched).toBe('failed');
		expect(result.image).toBe('failed');
		expect(result.blocked).toEqual([
			'connect-src https://example.com/collect?x=1',
			'img-src https://example.com/pixel.gif'
		]);
		expect(reached).toBe(0);
	});
}

test('Settings says the app contacts no servers, and lists every plugin', async ({ page }) => {
	await gotoHydrated(page, url('/settings'));
	const privacy = page.getByTestId('settings-privacy');
	await expect(privacy.getByRole('heading', { name: 'Privacy' })).toBeVisible();
	await expect(privacy).toContainText('Minimal never contacts a server.');
	await privacy.getByText('Plugins (12)').click();
	await expect(privacy.getByRole('listitem')).toHaveCount(12);
	await expect(privacy.getByRole('listitem').first()).toHaveText(
		/@xcwds\/plugin-shell\s*No network/
	);
});

// The base-path build gives plugin-hello an `origin` option, and its `network` function declares it
// (#103): the CSP, the worker guard and Settings all take the origin the options name.
test.describe('with network use worked out from options', () => {
	const sub = fileURLToPath(new URL('../build-sub', import.meta.url));
	const ORIGIN = 'https://greetings.example';
	let subServer: StaticServer;
	const subUrl = (path: string) => subServer.url(path);
	test.beforeAll(async () => {
		subServer = await serveStatic(sub, { base: '/sub' });
	});
	test.afterAll(() => subServer.close());

	test('the CSP allows the declared origin and still blocks others', async ({ page }) => {
		const reached: string[] = [];
		await page.route(/^https:\/\/(greetings\.example|example\.com)\//, (route) => {
			reached.push(new URL(route.request().url()).origin);
			return route.fulfill({
				status: 200,
				body: 'ok',
				headers: { 'access-control-allow-origin': '*' }
			});
		});
		await gotoHydrated(page, subUrl('/'));
		const csp = await page
			.locator('meta[http-equiv="content-security-policy"]')
			.getAttribute('content');
		expect(csp).toMatch(/connect-src 'self' https:\/\/greetings\.example[;\s]/);
		const result = await page.evaluate(async (origin) => {
			const host = ['example', 'com'].join('.');
			const attempt = (target: string) =>
				fetch(target).then(
					() => 'sent',
					() => 'failed'
				);
			return {
				declared: await attempt(`${origin}/hi`),
				undeclared: await attempt(`https://${host}/collect`)
			};
		}, ORIGIN);
		expect(result).toEqual({ declared: 'sent', undeclared: 'failed' });
		expect(reached).toEqual([ORIGIN]);
	});

	test.describe('with the service worker', () => {
		test.use({ serviceWorkers: 'allow' });

		test('the worker guard allows the declared origin and blocks others', async ({
			page,
			context
		}) => {
			await context.route(/^https:\/\/(greetings\.example|example\.com)\//, (route) =>
				route.fulfill({ body: 'reached' })
			);
			const registered = context.waitForEvent('serviceworker');
			await gotoHydrated(page, subUrl('/'));
			const worker = context.serviceWorkers()[0] ?? (await registered);
			const result = await worker.evaluate(async (origin) => {
				const host = ['example', 'com'].join('.');
				const attempt = (target: string) =>
					fetch(target).then(
						() => 'sent',
						(error: unknown) => String(error)
					);
				return {
					declared: await attempt(`${origin}/hi`),
					undeclared: await attempt(`https://${host}/collect`)
				};
			}, ORIGIN);
			expect(result.declared).toBe('sent');
			expect(result.undeclared).toMatch(/blocked a request to https:\/\/example\.com/);
		});
	});

	test('Settings credits the origin to the plugin', async ({ page }) => {
		await gotoHydrated(page, subUrl('/settings'));
		const privacy = page.getByTestId('settings-privacy');
		await expect(privacy).toContainText('Minimal only contacts these servers.');
		await expect(privacy.getByRole('listitem').first()).toHaveText(
			/^greetings\.example:\s*Fetches greetings\s*\(@xcwds-example\/plugin-hello\)$/
		);
	});
});
