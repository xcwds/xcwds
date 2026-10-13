/** Shared pieces of the unlock screen and the Settings controls. */
import type { HTMLInputAttributes } from 'svelte/elements';

/** Shows a confirmation with `app.toast` (from `@xcwds/plugin-shell`), when the app has it. */
export function toast(app: object, message: string): void {
	(app as { toast?: (message: string) => void }).toast?.(message);
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
