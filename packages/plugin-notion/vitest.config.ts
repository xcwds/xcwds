import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'plugin-notion',
		environment: 'node',
		include: ['src/**/*.test.ts', 'relay/**/*.test.ts'],
		expect: { requireAssertions: true }
	}
});
