import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'plugin-vault',
		environment: 'node',
		include: ['src/**/*.test.ts'],
		expect: { requireAssertions: true }
	}
});
