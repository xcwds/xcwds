<script>
	/** A page shipped by a plugin package and mounted by a thin route file (decision 2). */
	import { persist, settings, useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';

	const app = useApp();
	let count = $state(0);
	/** @type {string[]} */
	let files = $state([]);
	const listFiles = async () =>
		(files = (await app.blobs.list(app.hello.files)).map((f) => f.meta?.name ?? f.id));
	onMount(() => {
		void listFiles();
		return app.blobs.onChange(() => void listFiles());
	});
	/** @param {Event & { currentTarget: HTMLInputElement }} event */
	async function attach(event) {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = '';
		if (!file) return;
		const saved = await app.blobs.put(app.hello.files, file, { name: file.name });
		app.toast?.(saved ? 'File saved.' : "Couldn't save the file.");
		await listFiles();
	}
	persist(
		app.hello.count,
		() => count,
		(v) => (count = v)
	);
</script>

<p data-testid="plugin-page">
	{settings.current.greeting ?? 'hello'} from a plugin's page component
</p>
<p>
	<button type="button" data-testid="count" onclick={() => count++}>Pressed {count} times</button>
</p>
<p>
	<label>
		Keep a file
		<input type="file" class="block min-h-11 max-w-full" data-testid="attach" onchange={attach} />
	</label>
</p>
<ul data-testid="files">
	{#each files as name, i (i)}
		<li>{name}</li>
	{/each}
</ul>
<p>
	<button
		type="button"
		data-testid="greeting"
		onclick={() => {
			settings.set({ greeting: 'hey' });
			app.toast?.('Greeting saved.');
		}}
	>
		Say hey instead
	</button>
</p>
