import type { Request, Response } from 'express';

/**
 * A route declared by where the file is, which is Medusa v2's convention.
 *
 * Express is underneath and this repository depends on it, so the Express reader
 * is turned on — and there is not one application value anywhere for it to read a
 * route off. It came away with nothing, which is also what a repository that
 * merely depends on Express looks like from in here, and it used to say nothing
 * about which of the two this was. On a commerce monorepo that was 769 of 791 source files
 * producing no node, in silence (R84).
 *
 * The reader for this convention is a separate ticket. What this fixture holds it
 * to is the row.
 */
export const GET = async (req: Request, res: Response): Promise<void> => {
  res.json([{ id: req.query['id'] }]);
};

export const POST = async (req: Request, res: Response): Promise<void> => {
  res.status(201).json(req.body);
};
