import { instrument } from '@lending/telemetry';
import { Router, type Request, type Response } from 'express';

import { closeLoan, findLoan, holdsFromCache, holdsFromTable, listLoansFor, saveLoan } from '../lib/loans';
import { firstOf, traced, withSpan } from '../lib/tracing';

export const loansRouter = Router();

// A name, then the handler, inline.
loansRouter.get('/:id', withSpan('getLoan', getLoan));

// A name, then the handler, through a const.
const listLoansTraced = withSpan('listLoans', listLoans);
loansRouter.get('/', listLoansTraced);

// Options, then a handler written in place.
loansRouter.post(
  '/',
  traced({ name: 'createLoan' }, async (req: Request<unknown, unknown, { isbn: string }>, res: Response) => {
    const loan = await saveLoan(req.body.isbn);
    return res.status(201).json(loan);
  }),
);

// The handler, then options, from a package that is not installed.
loansRouter.post('/:id/return', instrument(returnLoan, { segment: 'returns' }));

// Two handlers handed over: which one answers is not in the call.
loansRouter.get('/:id/holds', firstOf(cachedHolds, tableHolds));

async function getLoan(req: Request, res: Response): Promise<unknown> {
  return res.json(await findLoan(req.params['id'] as string));
}

async function listLoans(req: Request, res: Response): Promise<unknown> {
  return res.json(await listLoansFor(req.query['borrower'] as string));
}

async function returnLoan(req: Request, res: Response): Promise<unknown> {
  return res.json(await closeLoan(req.params['id'] as string));
}

async function cachedHolds(_req: Request, res: Response): Promise<unknown> {
  const holds = await holdsFromCache();
  return holds === undefined ? undefined : res.json(holds);
}

async function tableHolds(_req: Request, res: Response): Promise<unknown> {
  return res.json(await holdsFromTable());
}
