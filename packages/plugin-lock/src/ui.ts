/** Shared pieces of the unlock screen and the Settings controls. */
import type { Backup, Group, StorageRegistry } from '@xcwds/core';
import type { HTMLInputAttributes } from 'svelte/elements';

/** Shows a confirmation with `app.toast` (from `@xcwds/plugin-shell`), when the app has it. */
export function toast(app: object, message: string): void {
	(app as { toast?: (message: string) => void }).toast?.(message);
}

/** A storage group's name as Settings → Your data shows it (its `groups` option), else its label. */
export function groupLabel(app: object): (group: Group) => string {
	const names = (app as { settingsPage?: { options: { groups: Record<string, string> } } })
		.settingsPage?.options.groups;
	return (group) => names?.[group.id] ?? group.label;
}

/**
 * Downloads `backup` as Settings names its files (`backupName` from `@xcwds/plugin-settings`,
 * then the date).
 */
export function downloadBackup(app: object, backup: Backup): void {
	const now = new Date();
	const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
		.map((n) => String(n).padStart(2, '0'))
		.join('-');
	const base =
		(app as { settingsPage?: { options: { backupName: string } } }).settingsPage?.options
			.backupName ?? 'backup';
	const file = new File([JSON.stringify(backup, null, '\t')], `${base}-${date}.json`, {
		type: 'application/json'
	});
	const url = URL.createObjectURL(file);
	Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * While locked, with `@xcwds/plugin-vault`: a backup of only what the vault keeps sealed (format 3,
 * #79), nothing readable, for "Forgot passcode". Undefined when there's nothing sealed to back up.
 */
export async function sealedBackup(
	storage: Pick<StorageRegistry, 'exportBackup'>
): Promise<Backup | undefined> {
	// A core before #79 has no backup sections.
	if (!storage.exportBackup) return undefined;
	const backup = await storage.exportBackup();
	const vault = backup.sections?.vault as { groups?: object } | undefined;
	if (!vault?.groups || !Object.keys(vault.groups).length) return undefined;
	return { ...backup, data: {}, unclaimed: {}, unclaimedVersions: {}, sections: { vault } };
}

/** Classes for the components' controls (colours from `@xcwds/plugin-shell/styles.css`). */
export const ui = {
	primary:
		'min-h-11 rounded-xl bg-(--xcwds-shell-accent) px-4 font-medium text-white hover:not-disabled:opacity-90 disabled:opacity-40',
	secondary:
		'min-h-11 rounded-xl bg-(--xcwds-shell-card) px-4 font-medium hover:not-disabled:bg-(--xcwds-shell-hover-bg) disabled:opacity-40',
	danger:
		'min-h-11 rounded-xl bg-red-700 px-4 font-medium text-white hover:not-disabled:bg-red-800 disabled:opacity-40',
	field:
		'min-h-11 w-full rounded-xl border border-(--xcwds-shell-border) bg-transparent px-3 text-base',
	muted: 'text-sm text-(--xcwds-shell-muted)',
	error: 'text-sm text-red-700 dark:text-red-400'
};

/** The attributes a passcode field gets: the right keyboard, and nothing remembered or checked. */
export function passcodeAttributes(kind: 'digits' | 'passphrase'): HTMLInputAttributes {
	return {
		type: 'password',
		inputmode: kind === 'digits' ? 'numeric' : 'text',
		...(kind === 'digits' ? { pattern: '[0-9]*' } : {}),
		autocomplete: 'off',
		autocapitalize: 'off',
		spellcheck: false
	};
}

/** "30 s", "1 min", "1 h 5 min": how long until `at`, rounded up. */
export function waitText(ms: number): string {
	const seconds = Math.max(1, Math.ceil(ms / 1000));
	if (seconds < 60) return `${seconds} s`;
	const minutes = Math.ceil(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
