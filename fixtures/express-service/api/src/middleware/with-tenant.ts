import type { NextFunction, Request, Response } from 'express';

/** Middleware installed on one router, covering the routes declared after it. */
export const withTenant = (req: Request, res: Response, next: NextFunction): unknown => {
  if (req.header('x-tenant') === undefined) return res.status(400).send();
  return next();
};
