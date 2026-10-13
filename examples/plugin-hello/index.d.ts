import type { Descriptor, Plugin } from '@xcwds/core';
import '@xcwds/sveltekit';

export type HelloOptions = {
	greeting?: string;
	/** An origin the app may fetch greetings from, declared as the plugin's network use. */
	origin?: string;
};

declare const hello: (options?: HelloOptions) => Descriptor<HelloOptions>;
export default hello;
export declare const build: Plugin<HelloOptions>;
