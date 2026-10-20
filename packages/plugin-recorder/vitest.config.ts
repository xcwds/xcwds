import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'plugin-recorder',
		environment: 'node',
		include: ['src/**/*.test.ts'],
		expect: { requireAssertions: true }
	}
});
