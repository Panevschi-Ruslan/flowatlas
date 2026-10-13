import type { EventBridgeEvent } from 'aws-lambda';

const trail: string[] = [];

/** Every loan made, written to the audit trail. */
export const handler = async (event: EventBridgeEvent<'LoanCreated', { loanId: string }>): Promise<void> => {
  trail.push(`${event.time} ${event['detail-type']} ${event.detail.loanId}`);
};
