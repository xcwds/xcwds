import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'plugin-blocks',
		environment: 'node',
		include: ['src/**/*.test.ts'],
		expect: { requireAssertions: true }
	}
});
