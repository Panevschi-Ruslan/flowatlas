import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Runs a request handler inside a named span: the name first, the handler
 * second, and every argument handed on.
 */
export const withSpan =
  (name: string, handler: RequestHandler): RequestHandler =>
  async (req: Request, res: Response, next: NextFunction) => {
    const started = Date.now();
    try {
      return await handler(req, res, next);
    } finally {
      console.log(JSON.stringify({ span: name, ms: Date.now() - started }));
    }
  };

/** The same with an options object first. */
export function traced(options: { name: string }, handler: RequestHandler): RequestHandler {
  return (req, res, next) => withSpan(options.name, handler)(req, res, next);
}

/** Answers from the first of two handlers: handed two functions, so a wrapper of neither. */
export const firstOf =
  (primary: RequestHandler, fallback: RequestHandler): RequestHandler =>
  async (req, res, next) =>
    (await primary(req, res, next)) ?? fallback(req, res, next);
