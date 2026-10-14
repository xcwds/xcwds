import type { Collection, Entry, Plugin } from '@xcwds/core';
import type { HelloOptions } from './index.js';

declare module '@xcwds/core' {
	interface App {
		hello: {
			count: Entry<number>;
			journal: Entry<string>;
			files: Collection<{ name: string }>;
		};
	}
	interface Settings {
		greeting: string;
	}
}

declare const plugin: Plugin<HelloOptions>;
export default plugin;
