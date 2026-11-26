import { Router } from 'express';

/**
 * The same shape as the catalog, but another module writes the member too
 * (`plugins.override.ts`), so what it holds is somebody's account of it.
 */
export const plugins = { router: Router() };

plugins.router.get('/list', (_req, res) => {
  res.json([]);
});
