/**
 * The plugin's name and the @xcwds/core versions it works with. The plugin's entries (`index.ts`,
 * `client.ts`) and its components come in later slices of #151; until then only `./corners`,
 * `./geometry`, `./warp`, `./filters`, `./pdf`, `./pages` and `./process` are exported.
 */
export const NAME = '@xcwds/plugin-scanner';
/**
 * The same range as the peer dependency (`scripts/sync-core-version.js` moves it along with
 * core's minor versions).
 */
export const CORE = '^0.5.0';
