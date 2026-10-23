import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineProject } from 'vitest/config';

export default defineProject({
	// Compiles the components so their tests can render them with `svelte/server`.
	plugins: [svelte()],
	test: {
		name: 'plugin-notion',
		environment: 'node',
		include: ['src/**/*.test.ts', 'relay/**/*.test.ts'],
		expect: { requireAssertions: true }
	}
});
