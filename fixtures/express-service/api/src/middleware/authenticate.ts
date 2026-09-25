import type { NextFunction, Request, Response } from 'express';

/**
 * The guard equivalent: middleware installed on the whole application.
 *
 * Nothing about it says which routes it covers. What says so is where it is
 * installed relative to the mounts around it, which is why the reader has to
 * put the calls in order before it can answer anything about guards.
 */
export const authenticate = (req: Request, res: Response, next: NextFunction): unknown => {
  if (req.header('authorization') === undefined) return res.status(401).send();
  return next();
};

/** Middleware written for one route, beside its handler. */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): unknown => {
  if (req.header('x-role') !== 'admin') return res.status(403).send();
  return next();
};
