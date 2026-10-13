import { Router, type Request, type Response } from 'express';
import { auditLoan, publishLoanCreated, publishLoanRenewed, type Loan } from './loan-events';

export const loansRouter = Router();

export const createLoan = async (req: Request<unknown, unknown, Loan>, res: Response): Promise<unknown> => {
  const loan = req.body;
  await publishLoanCreated(loan);
  await auditLoan(loan);
  return res.status(201).json(loan);
};

export const renewLoan = async (req: Request<{ loanId: string }>, res: Response): Promise<unknown> => {
  const renewal = { loanId: req.params.loanId, dueOn: '2026-11-01', renewals: 1 };
  await publishLoanRenewed(renewal);
  return res.json(renewal);
};

loansRouter.post('/', createLoan);
loansRouter.post('/:loanId/renewals', renewLoan);
