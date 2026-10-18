import { loadPage } from '#lib/server/load.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => loadPage(`/reference/${params.name}`);
