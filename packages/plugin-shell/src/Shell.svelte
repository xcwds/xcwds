<script lang="ts">
	/**
	 * The app shell: a header with the page title (the page's only `<h1>`) and a back arrow, the
	 * main navigation (a tab bar on phones; header links or a sidebar on wider screens, per the
	 * `nav` setting), and one notification stack. Wrap the root layout's content in it, inside
	 * `<App>`; pages render their own `<main class="page-narrow">`, `page-wide` or `page-split`.
	 *
	 * ```svelte
	 * <App><Shell>{@render children()}<Snippet notices>…</Snippet></Shell></App>
	 * ```
	 */
	import { page } from '$app/state';
	import { appPath, brand, useApp } from '@xcwds/sveltekit';
	import type { Snippet } from 'svelte';
	import type { PageTitle, Slot } from './client.js';
	import { activeSection, pageInfo } from './nav.js';
	import { hiddenSectionsCss } from './options.js';
	import { href } from './paths.js';
	import Toaster from './Toaster.svelte';

	let {
		children,
		notices
	}: {
		children: Snippet;
		/** More notices for the stack, e.g. `<UpdateBanner />` and `<OfflineNotice />`. */
		notices?: Snippet;
	} = $props();

	const app = useApp();
	const shell = app.shell;
	const sections = shell?.sections ?? [];
	let actions = $state.raw<readonly Slot[]>(shell?.header.list() ?? []);
	$effect(() => shell?.header.subscribe((list) => (actions = list)));
	let custom = $state.raw<PageTitle | undefined>(shell?.title.get());
	$effect(() => shell?.title.subscribe((t) => (custom = t)));

	const path = $derived(appPath(page.url.pathname) ?? page.url.pathname);
	const info = $derived(
		pageInfo(path, {
			sections,
			route: (p) => app.routes.get(p),
			appName: brand.name,
			error: page.error ? page.status : undefined
		})
	);
	const active = $derived(activeSection(sections, path));
	const nav = sections.length > 1;
	// Sections of apps that are off are hidden by CSS, before first paint too (#159).
	const hideCss = hiddenSectionsCss(sections);
	/**
	 * The header lines up with the page's container: wide pages always, narrow ones beside the
	 * sidebar (header links need more room than a narrow page has), and split ones like narrow
	 * ones until their two columns fit (`xl`).
	 */
	const headerWidth = $derived(
		{
			wide: 'page-wide',
			narrow: 'page-wide sidebar:page-narrow',
			split: 'page-wide sidebar:page-narrow xl:sidebar:page-wide'
		}[info.width]
	);
	/** A title the page set for itself (`app.shell.setTitle`), only on the page that set it. */
	const own = $derived(
		custom && !page.error && custom.path === page.url.pathname ? custom.text : undefined
	);
	const title = $derived(own ?? info.title);
	// A private page's <title> keeps its route's title, out of the history and app switcher.
	const tabTitle = $derived(app.routes.get(path)?.private ? info.title : title);
	const pageTitle = $derived(tabTitle === brand.name ? brand.name : `${tabTitle} · ${brand.name}`);
	const linkClass = (current: boolean) =>
		current
			? 'bg-(--xcwds-shell-active-bg) text-(--xcwds-shell-text)'
			: 'text-(--xcwds-shell-muted) hover:bg-(--xcwds-shell-hover-bg)';
</script>

<svelte:head>
	<title>{pageTitle}</title>
	{#if hideCss}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- built from checked app ids -->
		{@html `<style>${hideCss}</style>`}
	{/if}
</svelte:head>

<div class="xcwds-shell min-h-svh bg-(--xcwds-shell-bg) text-(--xcwds-shell-text)">
	{#if nav}
		<!-- First in the DOM so keyboard users reach it before the page, like the header links. -->
		<nav
			aria-label="Main"
			data-shell-nav="sidebar"
			class="fixed inset-y-0 left-0 z-10 hidden w-[calc(14rem+env(safe-area-inset-left))] flex-col gap-1 border-r border-(--xcwds-shell-border) bg-(--xcwds-shell-bar) pt-[calc(env(safe-area-inset-top)+0.75rem)] pr-3 pb-3 pl-[calc(env(safe-area-inset-left)+0.75rem)] backdrop-blur sidebar:flex"
		>
			<p class="px-3 py-2 text-lg font-semibold">{brand.name}</p>
			<ul class="flex flex-col gap-1">
				{#each sections as section (section.path)}
					<li data-app={section.app}>
						<a
							href={href(section.path)}
							aria-current={active === section.path ? 'page' : undefined}
							class="flex min-h-11 items-center gap-3 rounded-xl px-3 font-medium {linkClass(
								active === section.path
							)}"
						>
							{#if section.emoji}<span aria-hidden="true" class="text-xl">{section.emoji}</span
								>{/if}
							{section.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}

	<!-- Not sticky: long titles wrap, and the tab bar or sidebar keeps navigation in reach. -->
	<header class="pt-[env(safe-area-inset-top)] sidebar:pl-[calc(14rem+env(safe-area-inset-left))]">
		<div class="flex items-center gap-2 py-3 {headerWidth}">
			{#if info.parent}
				<a
					href={href(info.parent)}
					aria-label="Back to {info.parentLabel}"
					data-shell-back
					class="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-(--xcwds-shell-muted) hover:bg-(--xcwds-shell-hover-bg)"
				>
					<svg
						viewBox="0 0 24 24"
						class="size-6"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						aria-hidden="true"
					>
						<path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</a>
			{/if}
			<h1 class="min-w-0 flex-1 text-xl font-semibold text-balance">
				{#if info.emoji}<span aria-hidden="true">{info.emoji}</span>{/if}
				{title}
			</h1>
			{#each actions as action (action)}
				<action.component {...action.props} />
			{/each}
			{#if nav}
				<nav aria-label="Main" data-shell-nav="header" class="hidden gap-1 md:flex sidebar:hidden">
					{#each sections as section (section.path)}
						<a
							data-app={section.app}
							href={href(section.path)}
							aria-current={active === section.path ? 'page' : undefined}
							class="flex min-h-11 items-center rounded-full px-3 text-sm font-medium {linkClass(
								active === section.path
							)}"
						>
							{section.label}
						</a>
					{/each}
				</nav>
			{/if}
		</div>
	</header>

	<div
		class="{nav
			? 'pb-[calc(4.5rem+env(safe-area-inset-bottom))]'
			: 'pb-[env(safe-area-inset-bottom)]'} md:pb-0 sidebar:pl-[calc(14rem+env(safe-area-inset-left))]"
	>
		{@render children()}
	</div>

	<!-- Toasts and notices stack above the tab bar (top right on wider screens, clear of the
	     page title). Only their links and buttons take taps; the rest passes through to the page. -->
	<div
		data-shell-notices
		class="pointer-events-none fixed inset-x-0 {nav
			? 'bottom-[calc(4.25rem+env(safe-area-inset-bottom))]'
			: 'bottom-[calc(1rem+env(safe-area-inset-bottom))]'} z-20 flex flex-col items-center gap-2 px-4 md:top-[calc(1rem+env(safe-area-inset-top))] md:right-[calc(1rem+env(safe-area-inset-right))] md:bottom-auto md:left-auto md:w-full md:max-w-md md:items-end md:px-0 [&_a]:pointer-events-auto [&_button]:pointer-events-auto"
	>
		<Toaster />
		{@render notices?.()}
	</div>

	{#if nav}
		<nav
			aria-label="Main"
			data-shell-nav="tabs"
			class="fixed inset-x-0 bottom-0 z-10 border-t border-(--xcwds-shell-border) bg-(--xcwds-shell-bar) pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
		>
			<!-- One column per tab that shows: hidden ones (#159) take none. -->
			<ul class="mx-auto grid max-w-md auto-cols-fr grid-flow-col">
				{#each sections as section (section.path)}
					<li data-app={section.app}>
						<a
							href={href(section.path)}
							aria-current={active === section.path ? 'page' : undefined}
							class="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium {active ===
							section.path
								? 'text-(--xcwds-shell-accent)'
								: 'text-(--xcwds-shell-muted)'}"
						>
							{#if section.emoji}
								<span
									aria-hidden="true"
									class="text-xl {active === section.path ? '' : 'opacity-70'}"
									>{section.emoji}</span
								>
							{/if}
							{section.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}
</div>
