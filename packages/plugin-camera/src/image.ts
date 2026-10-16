/**
 * `@xcwds/plugin-camera/image`: clean image files of their metadata, and read what they carried.
 * Framework-agnostic and safe to import during prerender (browser APIs are used only when called).
 */
export {
	cleanImage,
	fitSize,
	type CleanOptions,
	type CleanResult,
	type ImageType
} from './clean.js';
export { noMetadata, readMetadata, type ImageMetadata } from './metadata.js';
