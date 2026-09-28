import type { Request, Response } from 'express';

/** A second file, served at a second address nothing in the source spells out. */
export const GET = async (_req: Request, res: Response): Promise<void> => {
  res.json([]);
};
