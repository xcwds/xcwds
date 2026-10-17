import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'plugin-qr',
		environment: 'node',
		include: ['src/**/*.test.ts'],
		expect: { requireAssertions: true }
	}
});
