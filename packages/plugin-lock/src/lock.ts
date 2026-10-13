/**
 * The passcode lock's state (#76): whether a passcode is set, whether the app is locked, and the
 * wait after wrong tries. Unlocking lives in memory only, so every reload starts locked. Kept
 * apart from the page entry so it can be tested with a plain storage scope.
 */
import type { Entry, Group, StorageScope } from '@xcwds/core';
import {
	ITERATIONS,
	NO_ATTEMPTS,
	createVerifier,
	failed,
	parseAttempts,
	parseVerifier,
	passcodeProblem,
	verify,
	type Attempts,
	type PasscodeKind,
	type Verifier
} from './passcode.js';

export type LockState = {
	/** A passcode is set. */
	readonly enabled: boolean;
	/** Locked: private pages (or the whole app) need the passcode. False when not enabled. */
	readonly locked: boolean;
	/** Digits or a passphrase, so the unlock screen shows the right keyboard. */
	readonly kind: PasscodeKind | undefined;
	/** When the next try is allowed after wrong ones (ms since the epoch; 0 = now). */
	readonly retryAt: number;
};

/** What a try with a passcode did: `wait` means it wasn't checked (too soon after wrong ones). */
export type TryResult = 'ok' | 'wrong' | 'wait';

/** `app.lock`. */
export type AppLock = {
	readonly state: LockState;
	/** Calls `listener` now and on every change; returns a function that stops it. */
	subscribe(listener: (state: LockState) => void): () => void;
	/**
	 * Sets the first passcode (not when one is set: use `change`). Resolves to a sentence saying
	 * what's wrong with it, or undefined once it's saved. Setting it up leaves the app unlocked.
	 */
	setUp(code: string, kind: PasscodeKind): Promise<string | undefined>;
	unlock(code: string): Promise<TryResult>;
	/** Locks now (nothing happens without a passcode). */
	lock(): void;
	/** Changes the passcode; a problem with the new one comes back as a sentence. */
	change(current: string, next: string, kind: PasscodeKind): Promise<TryResult | string>;
	/** Turns the lock off; private pages open freely again. */
	turnOff(current: string): Promise<TryResult>;
	/** The storage groups a reset clears (those marked sensitive). */
	sensitiveGroups(): Group[];
	/**
	 * For a forgotten passcode: clears every sensitive group and the passcode, and returns the
	 * groups it cleared. There's no recovery.
	 */
	reset(): Group[];
};

export type LockEntries = {
	verifier: Entry<Verifier>;
	attempts: Entry<Attempts>;
	off: Entry<true>;
};

/** Registers the lock's saved data: the verifier and the wrong tries, both kept out of backups. */
export function lockEntries(storage: Pick<StorageScope, 'entry'>): LockEntries {
	return {
		verifier: storage.entry('verifier', {
			label: 'Passcode lock',
			parse: parseVerifier,
			group: 'lock',
			// A backup restored on another device mustn't lock it, and a backup file shouldn't let
			// someone guess the passcode offline.
			backup: false
		}),
		attempts: storage.entry('attempts', {
			label: 'Wrong passcode tries',
			parse: parseAttempts,
			group: 'lock',
			backup: false
		}),
		// Written by a deliberate turn-off, so other tabs know the passcode went with its owner's
		// say. Clearing the lock's group clears it too.
		off: storage.entry('off', {
			label: 'Passcode turned off',
			parse: (v) => (v === true ? true : undefined),
			group: 'lock',
			backup: false
		})
	};
}

type Storage = Pick<StorageScope, 'read' | 'write' | 'remove' | 'groups' | 'clear' | 'onChange'>;

export function createLock(
	storage: Storage,
	entries: LockEntries,
	options: { now?: () => number; iterations?: number } = {}
): { lock: AppLock; stop(): void } {
	const now = options.now ?? Date.now;
	const iterations = options.iterations ?? ITERATIONS;
	const listeners = new Set<(state: LockState) => void>();
	const verifier = () => storage.read(entries.verifier);
	const attempts = () => storage.read(entries.attempts) ?? NO_ATTEMPTS;
	let enabled = verifier() !== undefined;
	// Every start is locked when a passcode is set.
	let locked = enabled;
	/** Set while this tab removes the passcode itself, so the listener below lets it go. */
	let removing = false;
	let state = snapshot();
	// One try at a time, so two quick taps can't both slip under the wait.
	let queue: Promise<unknown> = Promise.resolve();
	const serial = <T>(task: () => Promise<T>): Promise<T> => {
		const run = queue.then(task, task);
		queue = run.catch(() => {});
		return run;
	};

	function snapshot(): LockState {
		const v = verifier();
		return { enabled, locked: enabled && locked, kind: v?.kind, retryAt: attempts().retryAt };
	}

	function changed() {
		state = snapshot();
		for (const listener of listeners) listener(state);
	}

	const sensitiveGroups = () => storage.groups().filter((g) => g.sensitive);

	function clearSensitive(): Group[] {
		const groups = sensitiveGroups();
		storage.clear(groups.flatMap((g) => g.entries));
		return groups;
	}

	function removePasscode() {
		removing = true;
		try {
			storage.write(entries.off, true);
			storage.remove(entries.verifier);
			storage.remove(entries.attempts);
		} finally {
			removing = false;
		}
	}

	/** Checks `code` against the passcode, counting a wrong try. */
	async function check(code: string): Promise<TryResult> {
		const v = verifier();
		if (!v) return 'wrong';
		if (now() < attempts().retryAt) return 'wait';
		if (await verify(code, v)) {
			if (storage.read(entries.attempts)) storage.remove(entries.attempts);
			return 'ok';
		}
		storage.write(entries.attempts, failed(attempts(), now()));
		changed();
		return 'wrong';
	}

	// The passcode can go without its owner's say: "Clear" in Settings → Your data, or another
	// tab. Then the data it guarded goes too, as a reset would clear it, so clearing the lock's
	// own data never opens the pages it locked.
	const stopListening = storage.onChange((key) => {
		if (key !== null && key !== entries.verifier.key && key !== entries.attempts.key) return;
		const had = enabled;
		enabled = verifier() !== undefined;
		// Turned off or reset (here or in another tab) leaves the marker; anything else doesn't.
		if (had && !enabled && !removing && storage.read(entries.off) === undefined) clearSensitive();
		if (!had && enabled) locked = true;
		changed();
	});

	const lock: AppLock = {
		get state() {
			return state;
		},
		subscribe(listener) {
			listeners.add(listener);
			listener(state);
			return () => void listeners.delete(listener);
		},
		setUp: (code, kind) =>
			serial(async () => {
				if (verifier()) return 'A passcode is already set. Change it instead.';
				const problem = passcodeProblem(code, kind);
				if (problem) return problem;
				if (!storage.write(entries.verifier, await createVerifier(code, kind, iterations)))
					return "Couldn't save the passcode (storage is full or blocked).";
				storage.remove(entries.off);
				enabled = true;
				locked = false;
				changed();
				return undefined;
			}),
		unlock: (code) =>
			serial(async () => {
				const result = await check(code);
				if (result === 'ok') {
					locked = false;
					changed();
				}
				return result;
			}),
		lock() {
			if (!enabled || locked) return;
			locked = true;
			changed();
		},
		change: (current, next, kind) =>
			serial(async () => {
				const problem = passcodeProblem(next, kind);
				if (problem) return problem;
				const result = await check(current);
				if (result !== 'ok') return result;
				if (!storage.write(entries.verifier, await createVerifier(next, kind, iterations)))
					return "Couldn't save the passcode (storage is full or blocked).";
				changed();
				return 'ok';
			}),
		turnOff: (current) =>
			serial(async () => {
				const result = await check(current);
				if (result !== 'ok') return result;
				removePasscode();
				enabled = false;
				locked = false;
				changed();
				return 'ok';
			}),
		sensitiveGroups,
		reset() {
			const groups = clearSensitive();
			removePasscode();
			enabled = false;
			locked = false;
			changed();
			return groups;
		}
	};
	return { lock, stop: stopListening };
}
