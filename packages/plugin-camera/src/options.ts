/** The plugin's options, checked the same way in the build and the page. */
import { XcwdsError, codes } from '@xcwds/core';
import type { CameraOptions } from './camera.js';

export const NAME = '@xcwds/plugin-camera';
/**
 * The @xcwds/core versions this plugin works with, checked at boot: the same range as its peer
 * dependency (`scripts/sync-core-version.js` moves it along with core's minor versions).
 */
export const CORE = '^0.4.0';

/** The options, all JSON (RFC 0001, decision 1): the camera controller's, as written. */
export type CameraPluginOptions = CameraOptions;

const KEYS = ['facing', 'type', 'quality', 'maxSide', 'maxDigitalZoom', 'prefix'];

function fail(message: string): never {
	throw new XcwdsError(codes.CONFIG_INVALID, `${NAME}: ${message}`, { plugin: NAME });
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Checks options as written in the config, so a mistake fails the build rather than the page. */
export function resolveOptions(input: unknown = {}): CameraOptions {
	if (typeof input !== 'object' || input === null || Array.isArray(input))
		fail('options must be an object.');
	const options = input as Record<string, unknown>;
	const unknown = Object.keys(options).filter((k) => !KEYS.includes(k));
	if (unknown.length) fail(`unknown option ${unknown.map((k) => `\`${k}\``).join(', ')}.`);
	const { facing, type, quality, maxSide, maxDigitalZoom } = options;
	if (facing !== undefined && facing !== 'environment' && facing !== 'user')
		fail('`facing` must be "environment" (the back camera) or "user" (the front one).');
	if (type !== undefined && type !== 'image/jpeg' && type !== 'image/webp')
		fail('`type` must be "image/jpeg" or "image/webp".');
	if (quality !== undefined && !(isNumber(quality) && quality >= 0 && quality <= 1))
		fail('`quality` must be a number from 0 to 1.');
	if (maxSide !== undefined && !(isNumber(maxSide) && Number.isInteger(maxSide) && maxSide >= 1))
		fail('`maxSide` must be a whole number of pixels, 1 or more.');
	if (maxDigitalZoom !== undefined && !(isNumber(maxDigitalZoom) && maxDigitalZoom >= 1))
		fail('`maxDigitalZoom` must be a number, 1 or more (1 turns digital zoom off).');
	const out: CameraOptions = {};
	if (facing !== undefined) out.facing = facing;
	if (type !== undefined) out.type = type;
	if (quality !== undefined) out.quality = quality as number;
	if (maxSide !== undefined) out.maxSide = maxSide as number;
	if (maxDigitalZoom !== undefined) out.maxDigitalZoom = maxDigitalZoom as number;
	return out;
}
