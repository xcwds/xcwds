import tailwindcss from '@tailwindcss/vite';
import { xcwds } from '@xcwds/sveltekit/vite';
import { defineConfig } from 'vite';

// A GitHub Pages project site is served under /<repo>: the deploy workflow sets BASE_PATH. The
// e2e tests build under a base path too, into BUILD_DIR.
const base = (process.env.BASE_PATH ?? '') as '' | `/${string}`;
const out = process.env.BUILD_DIR ?? 'build';

export default defineConfig({
	plugins: [xcwds({ paths: { base } }, { adapter: { pages: out, assets: out } }), tailwindcss()]
});
