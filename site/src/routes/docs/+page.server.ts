import { loadIndex } from '#lib/server/load.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ pages: loadIndex('/docs') });
