import { Router } from 'express';

import { listItems, showItem } from './items.controller';

/**
 * One registration, several addresses.
 *
 * `router.get(['/items/:id', '/i/:id'], handler)` is legal Express and is how a
 * repository keeps a short address working beside the long one. The verbs of a
 * call have been folded from a list since the day they were read; the paths were
 * not, so a call written this way read as a route whose path could not be told,
 * and both addresses were missing from the graph while a row said only that
 * something was dynamic (R101).
 */
export const itemsRouter = Router();

itemsRouter.get(['/items/:id', '/i/:id'], showItem);

/** Named elsewhere and folded the same way, exactly as a list of verbs is. */
const LEGACY_PATHS = ['/legacy/items', '/old/items'];

itemsRouter.get(LEGACY_PATHS, listItems);

/** The ordinary form, unchanged, beside the two above. */
itemsRouter.get('/items', listItems);
