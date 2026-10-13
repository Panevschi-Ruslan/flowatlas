import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

export const events = new EventBridgeClient({ region: 'eu-west-1' });

export interface Loan {
  loanId: string;
  borrowerId: string;
  itemId: string;
}
