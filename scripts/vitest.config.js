import { defineProject } from 'vitest/config';

// Unit tests for the release scripts: *.test.js, run in Node.
export default defineProject({
	test: {
		name: 'scripts',
		include: ['*.test.js'],
		environment: 'node',
		expect: { requireAssertions: true }
	}
});
