import { Router, type Request, type Response } from 'express';

/**
 * The other router, mounted somewhere else.
 *
 * Its paths are relative to `/auth`, and no call taking the client's default
 * base can reach them: a request recorded under `/api` lands at an address this
 * repository does not serve. The call that means this route says which base it
 * wants, and the call is the only place that fact is written (R128).
 */
export const authRouter = Router();

authRouter.post(
  '/passkeys.generateRegistrationOptions',
  async (req: Request, res: Response): Promise<unknown> => res.json({ id: req.body.id }),
);
