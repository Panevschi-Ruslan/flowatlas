import { Application, Router } from 'express';

/**
 * `app` is a parameter. Its one caller hands it the server's application, a
 * maker's value, so the routes mounted on it are as sure as the application.
 */
export function mountOrders(app: Application) {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json([]);
  });
  router.post('/', (req, res) => {
    res.status(201).json(req.body);
  });
  app.use('/api/orders', router);
}
