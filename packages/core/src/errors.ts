/** Every error the kernel throws has a stable `code`, like Fastify's `FST_ERR_*`. */
export const codes = {
	PLUGIN_NOT_A_FUNCTION: 'XCWDS_ERR_PLUGIN_NOT_A_FUNCTION',
	PLUGIN_DEPENDENCY: 'XCWDS_ERR_PLUGIN_DEPENDENCY',
	PLUGIN_DECORATOR_MISSING: 'XCWDS_ERR_PLUGIN_DECORATOR_MISSING',
	PLUGIN_VERSION_MISMATCH: 'XCWDS_ERR_PLUGIN_VERSION_MISMATCH',
	PLUGIN_DUPLICATE: 'XCWDS_ERR_PLUGIN_DUPLICATE',
	PLUGIN_NAMESPACE: 'XCWDS_ERR_PLUGIN_NAMESPACE',
	PLUGIN_TIMEOUT: 'XCWDS_ERR_PLUGIN_TIMEOUT',
	PLUGIN_FAILED: 'XCWDS_ERR_PLUGIN_FAILED',
	PLUGIN_OPTIONS: 'XCWDS_ERR_PLUGIN_OPTIONS',
	PLUGIN_META: 'XCWDS_ERR_PLUGIN_META',
	ALREADY_BOOTED: 'XCWDS_ERR_ALREADY_BOOTED',
	CLOSED: 'XCWDS_ERR_CLOSED',
	DECORATOR_EXISTS: 'XCWDS_ERR_DECORATOR_EXISTS',
	DECORATOR_RESERVED: 'XCWDS_ERR_DECORATOR_RESERVED',
	HOOK_INVALID: 'XCWDS_ERR_HOOK_INVALID',
	HOOK_FAILED: 'XCWDS_ERR_HOOK_FAILED',
	STORAGE_KEY: 'XCWDS_ERR_STORAGE_KEY',
	STORAGE_DUPLICATE_KEY: 'XCWDS_ERR_STORAGE_DUPLICATE_KEY',
	STORAGE_MIGRATION: 'XCWDS_ERR_STORAGE_MIGRATION',
	/** A storage layer can't serve a key while the app is locked (#79). */
	LOCKED: 'XCWDS_ERR_LOCKED',
	SETTINGS_FIELD_EXISTS: 'XCWDS_ERR_SETTINGS_FIELD_EXISTS',
	SETTINGS_FIELD_INVALID: 'XCWDS_ERR_SETTINGS_FIELD_INVALID',
	CONFIG_INVALID: 'XCWDS_ERR_CONFIG_INVALID'
} as const;

export type ErrorCode = (typeof codes)[keyof typeof codes];

export class XcwdsError extends Error {
	readonly code: ErrorCode;
	/** The plugin the error is about, when there is one. */
	readonly plugin: string | undefined;

	constructor(
		code: ErrorCode,
		message: string,
		options: { plugin?: string | undefined; cause?: unknown } = {}
	) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'XcwdsError';
		this.code = code;
		this.plugin = options.plugin;
	}
}
