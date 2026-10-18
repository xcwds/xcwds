import { defineConfig } from 'vitest/config';

// Unit tests for every package, the guide's example plugin, the docs site and the agent workflows'
// scripts. The example apps are covered by Playwright (`pnpm test:e2e`).
export default defineConfig({
	test: {
		projects: [
			'packages/*',
			'examples/plugin-tally',
			'site',
			{ test: { name: 'agents', include: ['.github/agents/test/*.test.js'] } }
		]
	}
});
