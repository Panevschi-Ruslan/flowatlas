import { Router } from 'express';

/**
 * A router handed back by a function of the repository: what `catalogRouter`
 * is rests on reading `makeRouter`'s return, an account of the value rather
 * than the value, so its routes stay `heuristic`.
 */
const makeRouter = () => Router();

export const catalogRouter = makeRouter();

catalogRouter.get('/products', (_req, res) => {
  res.json([{ sku: 'mug' }]);
});

/**
 * Made directly, and mounted on `catalogRouter`. Its own value is sure; where
 * it is served is not, because the mount is written on a router recognised
 * only through the function above.
 */
const reviewsRouter = Router();

reviewsRouter.get('/', (_req, res) => {
  res.json([]);
});

catalogRouter.use('/reviews', reviewsRouter);
