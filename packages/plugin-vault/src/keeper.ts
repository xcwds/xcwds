/**
 * Connects the vault to `@xcwds/plugin-lock`'s passcode (#79): `app.lock.keep(passcodeKeeper(vault))`
 * hands the vault the passcode whenever the lock has checked it, and the vault derives its key
 * from it with its own salt (never the lock verifier's).
 *
 * - **Set up:** turns the vault on, sealing the sensitive groups.
 * - **Unlock:** opens them. A vault that's still off (installed after the passcode was set) is
 *   turned on here, so existing data gets sealed at the first unlock.
 * - **Change:** seals everything again with a key from the new passcode and a fresh salt.
 * - **Turn off:** writes the sensitive groups back as plaintext.
 * - **Lock** forgets the key; **reset** (a forgotten passcode) deletes the sealed groups unread.
 *
 * With `files` (a blob vault from `./blobs`, #149), files get the vault's files' key whenever it's
 * open, and files saved before the vault was on are sealed in the background (at every unlock, so
 * a run cut short finishes later). Turning the lock off opens them all back before it returns.
 *
 * The shape matches plugin-lock's `PasscodeKeeper` without importing it, so this module needs
 * nothing but the vault. Nothing touches browser globals until a function runs.
 */
import type { BlobVault } from './blobs.js';
import { deriveKey, newSalt } from './seal.js';
import type { Vault } from './vault.js';

export type Keeper = {
	setUp(code: string): Promise<boolean>;
	unlock(code: string): Promise<boolean>;
	change(current: string, next: string): Promise<boolean>;
	turnOff(current: string): Promise<boolean>;
	lock(): void;
	reset(): void;
};

export type KeeperOptions = {
	/** PBKDF2 iterations for new keys (default 600,000, as `deriveKey`). For tests. */
	iterations?: number;
	/** The blob vault that seals the sensitive collections' files with the vault's files' key. */
	files?: BlobVault;
	/** Where files that couldn't be sealed or opened are reported (default: `console.error`). */
	onError?: (error: unknown) => void;
	/** How far sealing the files already saved has got, while it runs. */
	onProgress?: (progress: { done: number; total: number } | undefined) => void;
};

export function passcodeKeeper(vault: Vault, options: KeeperOptions = {}): Keeper {
	const { files } = options;
	const onError = options.onError ?? ((error) => console.error(error));
	const derive = (code: string, salt: string) => deriveKey(code, salt, options.iterations);
	/** Sealing the files already saved, while it runs. */
	let sealing: Promise<unknown> = Promise.resolve();

	/** Gives the files the key the vault opened with, and seals the ones still in plaintext. */
	const openFiles = <T>(ok: T): T => {
		const key = vault.fileKey();
		if (!files || !ok || !key) return ok;
		files.unlock(key);
		const run = async () => {
			const done = await files.sealAll((done, total) => options.onProgress?.({ done, total }));
			options.onProgress?.(undefined);
			if (!done)
				onError(new Error("Some files couldn't be encrypted yet; the next unlock tries again."));
		};
		sealing = sealing.then(run, run);
		return ok;
	};
	const turnOn = async (code: string) => {
		const salt = newSalt();
		return openFiles(await vault.enable(await derive(code, salt), salt));
	};
	/** Opens the vault with `code` (true when it's off or already open). */
	const open = async (code: string) => {
		const salt = vault.salt();
		if (!vault.state.locked || salt === undefined) return true;
		return openFiles(await vault.unlock(await derive(code, salt)));
	};
	return {
		async setUp(code) {
			// Still on with no passcode set (its salt kept apart from the lock's data): nothing can
			// open what it sealed any more, so it starts again.
			if (vault.state.enabled) vault.drop();
			return turnOn(code);
		},
		async unlock(code) {
			if (!vault.state.enabled) return turnOn(code);
			return open(code);
		},
		async change(current, next) {
			if (!vault.state.enabled) return turnOn(next);
			if (!(await open(current))) return false;
			const salt = newSalt();
			// The files' key stays the same, so the files need nothing.
			return vault.rekey(await derive(next, salt), salt);
		},
		async turnOff(current) {
			if (!vault.state.enabled) return true;
			if (!(await open(current))) return false;
			if (files) {
				await sealing;
				const key = vault.fileKey();
				if (key) files.unlock(key);
				// Opened while still on first: cut short here, nothing is lost and the vault stays on.
				if (!(await files.openAll())) return false;
			}
			if (!(await vault.disable())) return false;
			// Saved while the first pass ran, and sealed: opened now, while the key is still held.
			if (files && !(await files.openAll())) {
				// Kept in memory, so they still open until the page closes.
				onError(
					new Error("Some files couldn't be decrypted; they'll be unreadable after a reload.")
				);
				return true;
			}
			files?.lock();
			return true;
		},
		lock() {
			vault.lock();
			files?.lock();
		},
		reset() {
			vault.drop();
			files?.lock();
		}
	};
}
