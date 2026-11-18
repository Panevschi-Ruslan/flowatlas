import { Router } from 'express';

/** A member of an object written in place, written nowhere else: the maker's value. */
export const catalog = { router: Router() };

catalog.router.get('/products', (_req, res) => {
  res.json([]);
});
