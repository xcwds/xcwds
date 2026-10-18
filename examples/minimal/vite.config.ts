import tailwindcss from '@tailwindcss/vite';
import { xcwds } from '@xcwds/sveltekit/vite';
import { defineConfig } from 'vite';

// The e2e tests also build the app under a base path, as on `user.github.io/repo`.
const base = (process.env.BASE_PATH ?? '') as '' | `/${string}`;
const out = process.env.BUILD_DIR ?? 'build';

export default defineConfig({
	plugins: [xcwds({ paths: { base } }, { adapter: { pages: out, assets: out } }), tailwindcss()]
});
