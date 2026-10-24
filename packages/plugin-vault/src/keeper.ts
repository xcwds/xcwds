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
 * The shape matches plugin-lock's `PasscodeKeeper` without importing it, so this module needs
 * nothing but the vault. Nothing touches browser globals until a function runs.
 */
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
};

export function passcodeKeeper(vault: Vault, options: KeeperOptions = {}): Keeper {
	const derive = (code: string, salt: string) => deriveKey(code, salt, options.iterations);
	const turnOn = async (code: string) => {
		const salt = newSalt();
		return vault.enable(await derive(code, salt), salt);
	};
	/** Opens the vault with `code` (true when it's off or already open). */
	const open = async (code: string) => {
		const salt = vault.salt();
		if (!vault.state.locked || salt === undefined) return true;
		return vault.unlock(await derive(code, salt));
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
			return vault.rekey(await derive(next, salt), salt);
		},
		async turnOff(current) {
			if (!vault.state.enabled) return true;
			if (!(await open(current))) return false;
			return vault.disable();
		},
		lock: () => vault.lock(),
		reset: () => vault.drop()
	};
}
