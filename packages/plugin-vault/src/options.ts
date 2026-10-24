/**
 * The plugin's name and the @xcwds/core versions it works with. The plugin's entries (`index.ts`,
 * `client.ts`) come in later slices of #79; until then only `./seal`, `./vault`, `./blobs`
 * and `./keeper` are exported.
 */
export const NAME = '@xcwds/plugin-vault';
/**
 * The same range as the peer dependency (`scripts/sync-core-version.js` moves it along with
 * core's minor versions).
 */
export const CORE = '^0.4.0';
