/**
 * The page entry: puts the vault's storage layer over the app's storage and hands it the lock's
 * passcode (`app.lock.keep(passcodeKeeper(vault))`), so sensitive groups are sealed whenever a
 * passcode is set and open only while the app is unlocked. When another tab changes the key (a
 * new passcode, or the vault turned on there), this tab can't open the data any more, so the app
 * locks too and asks for the passcode again.
 *
 * Files in the blob collections of sensitive groups (photos, recordings, #149) are sealed too, with the vault's
 * files' key, through a blob layer over `app.blobs`. Files saved before the vault was on are
 * sealed in the background after unlocking (`app.vault.progress` says how far it has got).
 *
 * `app.vault` says whether the data is encrypted (for the Privacy section's wording). App updates
 * wait for writes still being sealed, so a reload never loses one.
 *
 * Imported at prerender too: the vault touches browser globals only once a function runs, and at
 * prerender no passcode is ever set.
 */
import { definePlugin } from '@xcwds/core';
import type {} from '@xcwds/plugin-lock/client';
import { createBlobVault } from './blobs.js';
import { passcodeKeeper } from './keeper.js';
import { CORE, LOCK, NAME, resolveOptions, type VaultPluginOptions } from './options.js';
import { createVault, type VaultState } from './vault.js';

export type { VaultState } from './vault.js';

/** `app.vault`. */
export type AppVault = {
	/** Whether sensitive groups are kept sealed, and whether they're open now. */
	readonly state: VaultState;
	/** Resolves once every write so far is sealed and saved (false if one couldn't be saved). */
	flush(): Promise<boolean>;
	/** While files saved before the vault was on are being sealed: how many are done of how many. */
	readonly progress: { done: number; total: number } | undefined;
};

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-vault`. */
		readonly vault?: AppVault;
	}
}

export default definePlugin(
	(app, input: VaultPluginOptions) => {
		resolveOptions(input);
		const vault = createVault(app.storage, {
			onError: (error) => void app.reportError(error),
			onLocked: () => app.lock?.lock()
		});
		const files = createBlobVault({
			// Every collection of a sensitive group, as for storage entries and the lock's reset.
			sensitive: () =>
				app.storage
					.groups()
					.filter((g) => g.sensitive)
					.flatMap((g) => g.collections.map((c) => c.key)),
			enabled: () => vault.state.enabled
		});
		app.blobs.layer(files.layer);
		let progress: AppVault['progress'];
		const stopKeeping = app.lock!.keep(
			passcodeKeeper(vault, {
				files,
				onError: (error) => void app.reportError(error),
				onProgress: (next) => (progress = next)
			})
		);
		app.decorate('vault', {
			get state() {
				return vault.state;
			},
			flush: () => vault.flush(),
			get progress() {
				return progress;
			}
		} satisfies AppVault);
		app.addHook('onBeforeReload', async () => {
			await vault.flush();
		});
		app.addHook('onClose', async () => {
			stopKeeping();
			await vault.flush();
			vault.stop();
		});
	},
	{ name: NAME, core: CORE, dependencies: [LOCK], encapsulate: false, network: false }
);
