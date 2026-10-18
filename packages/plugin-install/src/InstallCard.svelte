<script lang="ts">
	/**
	 * Offers to install the app: an Install button where the browser has a prompt, Add to Home
	 * Screen steps on iPhone and iPad, the browser menu elsewhere. Shows nothing once the app
	 * runs installed. Place it inside `<App>` (the settings plugin puts it on its page, as a card
	 * like its others). Its words: the defaults, then the plugin's `text` option, then `text`.
	 */
	import { useApp } from '@xcwds/sveltekit';
	import type { InstallState } from './client.js';
	import type { InstallText as Text } from './options.js';

	const defaults: Text = {
		heading: 'Install the app',
		intro: 'Get it on your home screen. It opens full-screen and works offline.',
		install: 'Install app',
		iosSteps: [
			'Open this page in <strong>Safari</strong>.',
			'Tap <strong>Share</strong> (the square with an arrow).',
			'Choose <strong>Add to Home Screen</strong>.'
		],
		menu: "Use your browser's menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>."
	};
	let { text = {} }: { text?: Partial<Text> } = $props();
	const install = useApp().install;
	const t = $derived({ ...defaults, ...install?.text, ...text });

	/** Only `<strong>` survives: everything else is shown as text. */
	const strong = (s: string) =>
		s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/&lt;(\/?)strong>/g, '<$1strong>');

	let current = $state<InstallState>({
		checked: false,
		installed: false,
		available: false,
		ios: false
	});
	$effect(() => install?.subscribe((value) => (current = value)));
	const id = $props.id();
</script>

{#if current.checked && !current.installed}
	<section class="xcwds-install" aria-labelledby={id} data-testid="install">
		<h2 {id}>{t.heading}</h2>
		<p>{t.intro}</p>
		{#if current.available}
			<button type="button" onclick={() => install?.prompt()}>{t.install}</button>
		{:else if current.ios}
			<ol>
				{#each t.iosSteps as step, i (i)}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<li>{@html strong(step)}</li>
				{/each}
			</ol>
		{:else}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<p>{@html strong(t.menu)}</p>
		{/if}
	</section>
{/if}

<style>
	/* A card like the settings page's others (with @xcwds/plugin-shell's colours). */
	section {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem;
		border-radius: 1rem;
		background: var(--xcwds-shell-card, transparent);
	}
	h2 {
		margin: 0;
		font-size: 1.125rem;
		line-height: 1.75rem;
		font-weight: 600;
	}
	p,
	ol {
		margin: 0;
	}
	ol {
		padding-left: 1.25rem;
		list-style: decimal;
	}
	button {
		min-width: 44px;
		min-height: 44px;
		padding: 0 1rem;
		border: 0;
		border-radius: 0.5rem;
		background: var(--xcwds-install-accent, #2563eb);
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
</style>
