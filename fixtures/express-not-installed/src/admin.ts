import { IRouter, Request, Response, Router } from 'express';

/**
 * medusa's admin bundler in miniature: a `Router()` at module scope, handed back
 * by a function the application mounts.
 */
const router = Router();

const sendHtml = (_req: Request, res: Response): void => {
  res.send('<html></html>');
};

export function serve(): IRouter {
  router.get('/', sendHtml);
  router.get('/*', sendHtml);
  return router;
}
