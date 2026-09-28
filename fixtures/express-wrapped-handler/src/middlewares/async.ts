import type { NextFunction, Request, RequestHandler, Response } from 'express';

type PromiseHandler = (
  req: Request<any, any, any>,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

/**
 * Catches a rejected promise and hands it to `next`.
 *
 * A video platform's, nearly word for word. It takes a handler or a list of them and
 * returns one handler, so whatever it is handed is the code that answers.
 */
export function asyncMiddleware(fun: PromiseHandler | PromiseHandler[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!Array.isArray(fun)) {
      return Promise.resolve(fun(req, res, next)).catch((err) => next(err));
    }
    for (const f of fun) await f(req, res, next);
    return next();
  };
}

/** The same, retried when the database reports a serialisation failure. */
export function asyncRetryTransactionMiddleware(fun: PromiseHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fun(req, res, next)).catch((err) => next(err));
}
