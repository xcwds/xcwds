import { defineConfig } from 'vitest/config';

// Unit tests for every package, the release scripts and the guide's example plugin. The example
// apps are covered by Playwright (`pnpm test:e2e`).
export default defineConfig({
	test: {
		projects: ['packages/*', 'examples/plugin-tally', 'site', 'scripts']
	}
});
