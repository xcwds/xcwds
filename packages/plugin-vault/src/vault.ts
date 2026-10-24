/**
 * The vault's storage layer (#79, RFC 0001 decision 11): keeps every sensitive group sealed in
 * storage as one AES-GCM blob, and serves the group's keys from memory while unlocked. Locked, a
 * sensitive key can't be read or saved (`XCWDS_ERR_LOCKED`). Writes go to memory at once and are
 * re-sealed asynchronously, one group at a time, in order. Another tab's re-seal is opened again
 * here. Lock-agnostic: whoever holds the passcode derives the key (`deriveKey` from `./seal`)
 * with `salt()` and calls `enable`, `unlock`, `lock`, `rekey`, `disable` or `drop`
 * (`passcodeKeeper` in `./keeper` does it for `@xcwds/plugin-lock`).
 *
 * Imported at prerender too, so nothing touches browser globals until a function runs.
 */
import { XcwdsError, codes, type Entry, type StorageAdapter, type StorageScope } from '@xcwds/core';
import { open, parseSealed, seal } from './seal.js';

export type VaultState = {
	/** A salt is saved: sensitive groups are kept sealed. */
	readonly enabled: boolean;
	/** Enabled and the key isn't in memory: sensitive keys can't be read or saved. */
	readonly locked: boolean;
};

export type Vault = {
	readonly state: VaultState;
	/** The salt the key is derived with (base64), or undefined while the vault is off. */
	salt(): string | undefined;
	/**
	 * Turns the vault on with `key` (derived from the passcode and a fresh `salt`): seals every
	 * sensitive group and removes its plaintext. Leaves it unlocked. False when it couldn't save
	 * (storage full or blocked); nothing changes then.
	 */
	enable(key: CryptoKey, salt: string): Promise<boolean>;
	/**
	 * Opens every sealed group with `key`. False, and still locked, when one doesn't open (a key
	 * from a wrong passcode). Plaintext a sensitive entry still has (it became sensitive after the
	 * vault was turned on) moves in and is sealed too.
	 */
	unlock(key: CryptoKey): Promise<boolean>;
	/** Forgets the key and the open data, once writes still being sealed are saved. */
	lock(): void;
	/**
	 * Seals everything again with `key` (unlocked only), derived from a new passcode and a fresh
	 * `salt`. False when it couldn't save; the old key and salt stay then.
	 */
	rekey(key: CryptoKey, salt: string): Promise<boolean>;
	/**
	 * Turns the vault off (unlocked only): writes the sensitive groups back as plaintext and
	 * removes the sealed copies and the salt. False when it couldn't save; nothing changes then.
	 */
	disable(): Promise<boolean>;
	/**
	 * For a forgotten passcode: deletes the sealed groups and the salt, unread. What they held is
	 * gone; there's no recovery.
	 */
	drop(): void;
	/** Resolves once every write so far is sealed and saved (false if one couldn't be saved). */
	flush(): Promise<boolean>;
	/** Stops following other tabs. */
	stop(): void;
};

export type VaultOptions = {
	/** Where a seal that couldn't be saved is reported (default: `console.error`). */
	onError?: (error: unknown) => void;
	/**
	 * The group the salt is saved in (default `lock`, with `@xcwds/plugin-lock`'s passcode):
	 * clearing that group drops the vault, as clearing the passcode clears what it guarded.
	 */
	group?: string;
	/**
	 * Called when another tab turned the vault on or sealed everything again with a new key (the
	 * passcode changed there): this tab has no key that opens it, so the vault locks, and the app
	 * should too.
	 */
	onLocked?: () => void;
};

const SALT_FIELD = /^[A-Za-z0-9+/]+={0,2}$/;

/** Parsed JSON, or undefined for none or anything that doesn't parse. */
function json(text: string | null): unknown {
	if (text === null) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** Group contents as sealed: storage key → the stored text. */
type Contents = Map<string, string>;

export function createVault(storage: StorageScope, options: VaultOptions = {}): Vault {
	if (!storage.namespace)
		throw new XcwdsError(codes.STORAGE_KEY, 'The vault needs a storage namespace of its own.');
	const onError = options.onError ?? ((error) => console.error(error));
	const saltEntry = storage.entry<string>('salt', {
		label: 'Encryption',
		parse: (v) => (typeof v === 'string' && SALT_FIELD.test(v) ? v : undefined),
		group: options.group ?? 'lock',
		// Useless without the passcode, and a backup restored elsewhere mustn't turn the vault on.
		backup: false
	});
	const sealedPrefix = `${storage.prefix}${storage.namespace}:sealed:`;
	const blobKey = (group: string) => sealedPrefix + encodeURIComponent(group);
	const groupOfBlob = (key: string) => decodeURIComponent(key.slice(sealedPrefix.length));
	const context = (group: string) => `group:${group}`;
	/** A value sealed with the key on `enable`, so `unlock` can tell a wrong key with nothing else saved. */
	const checkKey = `${storage.prefix}${storage.namespace}:check`;
	const CHECK = 'xcwds-vault';

	let inner!: StorageAdapter;
	let key: CryptoKey | null = null;
	/** The open groups while unlocked. */
	let memory = new Map<string, Contents>();
	const dirty = new Set<string>();
	let sealing: Promise<unknown> = Promise.resolve();
	/** Seals that couldn't be saved since the last `flush()`. */
	let failures = 0;
	/** Set while this tab changes the salt itself, so the listener below lets it go. */
	let changing = false;
	/**
	 * Moves on whenever the key the groups are sealed with changes (`rekey`, or another tab's):
	 * a seal queued before then mustn't save over what's sealed with the new key.
	 */
	let epoch = 0;
	/** The salt the key in memory was derived with. */
	let keySalt: string | undefined;
	/**
	 * Whether a seal made with the key of `at` may still be saved: no new key since, here or in
	 * another tab (whose new salt shows in storage before its event reaches this one).
	 */
	const current = (at: number) => epoch === at && savedSalt() === keySalt;

	/**
	 * The saved salt, read from the adapter below: reading it through the registry would come
	 * back through this layer.
	 */
	function savedSalt(): string | undefined {
		try {
			const text = inner.get(saltEntry.key);
			return text == null ? undefined : saltEntry.parse(JSON.parse(text));
		} catch {
			return undefined;
		}
	}
	const enabled = () => savedSalt() !== undefined;
	const locked = () => enabled() && key === null;

	/** Whether `entry` claims `storageKey`: its own key, or one id under a prefixed entry. */
	const owns = (entry: Entry<unknown>, storageKey: string) =>
		entry.prefix
			? storageKey.length > entry.key.length && storageKey.startsWith(entry.key)
			: entry.key === storageKey;

	/** The sensitive group a storage key belongs to, if any. */
	function sensitiveGroup(storageKey: string): string | undefined {
		if (
			storageKey.startsWith(sealedPrefix) ||
			storageKey === saltEntry.key ||
			storageKey === checkKey
		)
			return undefined;
		// An exact entry, or a prefixed one (#157) that claims the key.
		const entry = storage.entries().find((e) => owns(e, storageKey));
		if (!entry) return undefined;
		return storage.groups().some((g) => g.id === entry.group && g.sensitive)
			? entry.group
			: undefined;
	}

	/** The saved keys of sensitive groups: exact entries, and every id under a prefixed one. */
	const sensitiveKeys = (): { key: string; group: string }[] => {
		const groups = new Set(
			storage
				.groups()
				.filter((g) => g.sensitive)
				.map((g) => g.id)
		);
		const sensitive = storage.entries().filter((e) => groups.has(e.group));
		const below = sensitive.some((e) => e.prefix)
			? inner.keys().filter((k) => !k.startsWith(sealedPrefix))
			: [];
		return sensitive.flatMap((e) =>
			e.prefix
				? below.filter((k) => owns(e, k)).map((key) => ({ key, group: e.group }))
				: [{ key: e.key, group: e.group }]
		);
	};

	const lockedError = () =>
		new XcwdsError(codes.LOCKED, 'Sensitive data is sealed until the app is unlocked.');

	function contents(group: string): Contents {
		let c = memory.get(group);
		if (!c) memory.set(group, (c = new Map()));
		return c;
	}

	/** Whether a seal is queued that hasn't started yet (it takes every group dirty by then). */
	let queued = false;

	/**
	 * Seals the groups changed so far, in order after earlier seals, with the key they were
	 * written under: locking before it runs still saves them.
	 */
	function schedule(group: string) {
		dirty.add(group);
		if (queued || !key) return;
		queued = true;
		const sealingKey = key;
		const at = epoch;
		const run = async () => {
			queued = false;
			if (epoch !== at) {
				// Queued before a new key: seal them with that one instead (nothing while locked).
				for (const group of [...dirty]) {
					dirty.delete(group);
					schedule(group);
				}
				return;
			}
			const groups = [...dirty];
			dirty.clear();
			for (const group of groups) {
				const c = memory.get(group);
				const id = blobKey(group);
				try {
					if (!c || c.size === 0) {
						if (current(at)) inner.remove(id);
					} else {
						const text = JSON.stringify(Object.fromEntries(c));
						const sealed = JSON.stringify(await seal(sealingKey, text, context(group)));
						// Sealed again with a new key meanwhile, from what memory holds now.
						if (current(at)) inner.set(id, sealed);
					}
				} catch (cause) {
					failures++;
					onError(new Error(`Couldn't save the sealed copy of "${group}".`, { cause }));
				}
			}
		};
		sealing = sealing.then(run, run);
	}

	/** Removes plaintext moved into memory, once its group's seal is saved (it stays otherwise). */
	function removeAfterSealing(keys: string[]) {
		if (!keys.length) return;
		const failed = failures;
		void sealing.then(() => {
			if (failures !== failed) return;
			for (const k of keys)
				try {
					inner.remove(k);
				} catch {
					// Blocked storage: the plaintext stays until the next unlock moves it again.
				}
		});
	}

	/** Every sealed group in storage, as group → blob. */
	function blobs(): Map<string, unknown> {
		const out = new Map<string, unknown>();
		for (const k of inner.keys()) {
			if (!k.startsWith(sealedPrefix)) continue;
			const text = inner.get(k);
			if (text === null) continue;
			out.set(groupOfBlob(k), json(text));
		}
		return out;
	}

	async function openGroup(with_: CryptoKey, group: string, blob: unknown) {
		const sealed = parseSealed(blob);
		const text = sealed && (await open(with_, sealed, context(group)));
		if (text === undefined) return undefined;
		try {
			const parsed: unknown = JSON.parse(text);
			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
			const c: Contents = new Map();
			for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') c.set(k, v);
			return c;
		} catch {
			return undefined;
		}
	}

	const check = () => {
		if (locked()) throw lockedError();
	};

	storage.layer((below) => {
		inner = below;
		return {
			get(k) {
				const group = enabled() ? sensitiveGroup(k) : undefined;
				if (group === undefined) return below.get(k);
				check();
				return memory.get(group)?.get(k) ?? null;
			},
			set(k, value) {
				const group = enabled() ? sensitiveGroup(k) : undefined;
				if (group === undefined) return below.set(k, value);
				check();
				contents(group).set(k, value);
				schedule(group);
			},
			remove(k) {
				const group = enabled() ? sensitiveGroup(k) : undefined;
				if (group === undefined) return below.remove(k);
				check();
				if (memory.get(group)?.delete(k)) schedule(group);
			},
			keys() {
				const out = below.keys().filter((k) => !k.startsWith(sealedPrefix) && k !== checkKey);
				if (!enabled()) return out;
				const open = key ? [...memory.values()].flatMap((c) => [...c.keys()]) : [];
				return [...new Set([...out, ...open])];
			}
		};
	});

	/** Forgets the open data (not the sealed copies). */
	function forget() {
		key = null;
		keySalt = undefined;
		memory = new Map();
		dirty.clear();
	}

	function dropSealed() {
		for (const k of inner.keys()) if (k.startsWith(sealedPrefix)) inner.remove(k);
		inner.remove(checkKey);
	}

	// Another tab re-sealed a group, turned the vault off or dropped it.
	const stopListening = storage.onChange((k) => {
		if (k === null || changing) return;
		if (k === saltEntry.key) {
			if (enabled() && savedSalt() !== keySalt) {
				// Turned on, or sealed again with a new passcode, in another tab: what's open here (if
				// anything) can't be saved any more, and its writes would overwrite theirs. Locked
				// until the passcode, and the app is told so it locks too.
				epoch++;
				forget();
				storage.reload();
				options.onLocked?.();
				return;
			}
			if (!enabled()) {
				// Off or reset elsewhere (or "Clear" on the salt's group): nothing here opens any more.
				forget();
				try {
					dropSealed();
				} catch {
					// Blocked storage: nothing to delete.
				}
			}
			storage.reload();
			return;
		}
		if (!k.startsWith(sealedPrefix) || !key) return;
		const group = groupOfBlob(k);
		const opening = key;
		const text = inner.get(k);
		void (async () => {
			const c =
				text === null ? new Map<string, string>() : await openGroup(opening, group, json(text));
			if (!c || key !== opening) return;
			memory.set(group, c);
			storage.reload();
		})().catch(onError);
	});

	const vault: Vault = {
		get state() {
			return { enabled: enabled(), locked: locked() };
		},
		salt: savedSalt,
		async enable(newKey, salt) {
			if (enabled()) return false;
			await sealing;
			const groups = new Map<string, Contents>();
			for (const e of sensitiveKeys()) {
				const text = inner.get(e.key);
				if (text === null) continue;
				if (!groups.has(e.group)) groups.set(e.group, new Map());
				groups.get(e.group)!.set(e.key, text);
			}
			const sealed = new Map<string, string>();
			for (const [group, c] of groups)
				sealed.set(
					blobKey(group),
					JSON.stringify(await seal(newKey, JSON.stringify(Object.fromEntries(c)), context(group)))
				);
			sealed.set(checkKey, JSON.stringify(await seal(newKey, CHECK, 'check')));
			if (enabled()) return false;
			const written: string[] = [];
			changing = true;
			try {
				for (const [k, text] of sealed) {
					inner.set(k, text);
					written.push(k);
				}
				if (!storage.write(saltEntry, salt)) throw new Error('The salt could not be saved.');
			} catch {
				for (const k of written) inner.remove(k);
				changing = false;
				return false;
			}
			changing = false;
			key = newKey;
			keySalt = salt;
			memory = groups;
			// Writes that landed while sealing went to storage as plaintext: take them in, and remove
			// their plaintext only once they're sealed.
			const changed: string[] = [];
			for (const e of sensitiveKeys()) {
				const text = inner.get(e.key);
				if (text === null) continue;
				if (groups.get(e.group)?.get(e.key) === text) inner.remove(e.key);
				else {
					contents(e.group).set(e.key, text);
					schedule(e.group);
					changed.push(e.key);
				}
			}
			removeAfterSealing(changed);
			storage.reload();
			return true;
		},
		async unlock(newKey) {
			if (!enabled()) return false;
			if (key) return true;
			// Seals still running from before a lock finish first, so what they save is opened here.
			await sealing;
			if (key) return true;
			// Checked first, so a wrong key fails even with nothing sensitive saved.
			const sealedCheck = parseSealed(json(inner.get(checkKey)));
			if (!sealedCheck || (await open(newKey, sealedCheck, 'check')) !== CHECK) return false;
			const opened = new Map<string, Contents>();
			for (const [group, blob] of blobs()) {
				const c = await openGroup(newKey, group, blob);
				if (!c) return false;
				opened.set(group, c);
			}
			if (key) return true;
			key = newKey;
			keySalt = savedSalt();
			memory = opened;
			// Plaintext of entries that became sensitive since: move it in and seal it.
			const moved: string[] = [];
			for (const e of sensitiveKeys()) {
				const text = inner.get(e.key);
				if (text === null) continue;
				if (!contents(e.group).has(e.key)) contents(e.group).set(e.key, text);
				schedule(e.group);
				moved.push(e.key);
			}
			removeAfterSealing(moved);
			storage.reload();
			return true;
		},
		lock() {
			if (!key) return;
			key = null;
			// Sensitive keys refuse at once; the open data goes once pending writes are sealed.
			const pending = memory;
			storage.reload();
			const done = () => {
				if (key === null && memory === pending) memory = new Map();
			};
			void sealing.then(done, done);
		},
		async rekey(newKey, salt) {
			if (!enabled() || !key) return false;
			const was = key;
			if (!(await vault.flush()) || key !== was) return false;
			const sealed = new Map<string, string>();
			for (const [group, c] of memory)
				if (c.size)
					sealed.set(
						blobKey(group),
						JSON.stringify(
							await seal(newKey, JSON.stringify(Object.fromEntries(c)), context(group))
						)
					);
			sealed.set(checkKey, JSON.stringify(await seal(newKey, CHECK, 'check')));
			if (key !== was) return false;
			// What's saved now, to put back if a write fails part way.
			const before = new Map<string, string | null>();
			for (const k of sealed.keys()) before.set(k, inner.get(k));
			const oldSalt = savedSalt();
			changing = true;
			try {
				for (const [k, text] of sealed) inner.set(k, text);
				if (!storage.write(saltEntry, salt)) throw new Error('The salt could not be saved.');
			} catch {
				try {
					for (const [k, text] of before)
						if (text === null) inner.remove(k);
						else inner.set(k, text);
					if (oldSalt !== undefined) storage.write(saltEntry, oldSalt);
				} catch {
					// Blocked storage: nothing more to put back.
				}
				return false;
			} finally {
				changing = false;
			}
			epoch++;
			key = newKey;
			keySalt = salt;
			// Writes made while sealing above: seal the groups again from memory, with the new key.
			for (const group of memory.keys()) schedule(group);
			return vault.flush();
		},
		async disable() {
			if (!enabled() || !key) return false;
			if (!(await vault.flush())) return false;
			const written: string[] = [];
			try {
				for (const c of memory.values())
					for (const [k, text] of c) {
						inner.set(k, text);
						written.push(k);
					}
			} catch {
				for (const k of written) inner.remove(k);
				return false;
			}
			changing = true;
			try {
				storage.remove(saltEntry);
				dropSealed();
			} finally {
				changing = false;
			}
			forget();
			storage.reload();
			return true;
		},
		drop() {
			changing = true;
			try {
				storage.remove(saltEntry);
				dropSealed();
			} catch {
				// Blocked storage: nothing to delete.
			} finally {
				changing = false;
			}
			forget();
			storage.reload();
		},
		async flush() {
			await sealing;
			const ok = failures === 0;
			failures = 0;
			return ok;
		},
		stop: stopListening
	};
	return vault;
}
