import type { Entry, Plugin } from '@xcwds/core';
import type { HelloOptions } from './index.js';

declare module '@xcwds/core' {
	interface App {
		hello: { count: Entry<number>; journal: Entry<string> };
	}
	interface Settings {
		greeting: string;
	}
}

declare const plugin: Plugin<HelloOptions>;
export default plugin;
