import type { Request, Response } from 'express';

interface LoanRequest {
  borrowerId: string;
  itemIds: string[];
  branchId: string;
}

/**
 * Accepts a loan request and answers that it is being considered.
 *
 * Starting the approval workflow from here is a call into the cloud provider's
 * SDK by the workflow's deployed name, which a later reader joins; this handler
 * only records what was asked for.
 */
export const requestLoan = async (req: Request<unknown, unknown, LoanRequest>, res: Response): Promise<unknown> => {
  const { borrowerId, itemIds } = req.body;
  return res.status(202).json({ borrowerId, items: itemIds.length, status: 'pending' });
};
