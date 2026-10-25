import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'plugin-scanner',
		environment: 'node',
		include: ['src/**/*.test.ts'],
		expect: { requireAssertions: true }
	}
});
