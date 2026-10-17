import { pluginMeta } from '@xcwds/core';
import { describe, expect, it } from 'vitest';
import qr, { build } from './index.js';
import { resolveOptions } from './options.js';

describe('@xcwds/plugin-qr', () => {
	it('is a descriptor whose build entry talks to no server', () => {
		expect(qr()).toMatchObject({ name: '@xcwds/plugin-qr' });
		expect(pluginMeta(build)).toMatchObject({ name: '@xcwds/plugin-qr', network: false });
	});

	it('takes no options yet, and says so', () => {
		expect(resolveOptions()).toEqual({});
		expect(resolveOptions({})).toEqual({});
		expect(() => resolveOptions({ size: 4 })).toThrow(/unknown option `size`; it takes none yet/);
		expect(() => resolveOptions([])).toThrow(/must be an object/);
	});
});
