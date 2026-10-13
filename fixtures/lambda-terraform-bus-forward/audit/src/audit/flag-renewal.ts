import type { EventBridgeEvent } from 'aws-lambda';

const flagged = new Set<string>();

/** A renewal from any library source, flagged for the auditors to look at. */
export const handler = async (event: EventBridgeEvent<'LoanRenewed', { loanId: string }>): Promise<void> => {
  flagged.add(event.detail.loanId);
};
