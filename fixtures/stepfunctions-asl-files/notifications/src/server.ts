import express from 'express';
import type { Request, Response } from 'express';

/**
 * The notices a borrower has been sent, for the circulation desk to look up.
 *
 * Sending them is the two workflows in `workflows/`, which this code never
 * mentions.
 */
export const listNotices = async (req: Request<{ borrowerId: string }>, res: Response): Promise<unknown> =>
  res.json({ borrowerId: req.params.borrowerId, notices: [] });

export const app = express();

app.get('/notices/:borrowerId', listNotices);

app.listen(3001);
