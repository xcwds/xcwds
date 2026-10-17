import type { BlockData } from '../data.js';

/**
 * Saves a block's data: `change` gets what's saved now (another tab's change included, `undefined`
 * if nothing is) and returns the new data. Returns whether it was saved; a failure is reported
 * by the store, and the block shows what's saved.
 */
export type UpdateBlock<T extends BlockData> = (change: (current: T | undefined) => T) => boolean;
