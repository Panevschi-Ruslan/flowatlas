import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { events } from '../events/client';

export interface Loan {
  loanId: string;
  borrowerId: string;
  itemId: string;
  dueOn: string;
}

export interface Renewal {
  loanId: string;
  dueOn: string;
  renewals: number;
}

/** A command built in the call that sends it. */
export const publishLoanCreated = async (loan: Loan): Promise<void> => {
  await events.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: 'library-events',
          Source: 'library.loans',
          DetailType: 'LoanCreated',
          Detail: JSON.stringify(loan),
        },
      ],
    }),
  );
};

const bridge = new EventBridge({ region: 'eu-west-1' });

/** The aggregated client, whose methods take the input directly. */
export const publishLoanRenewed = async (renewal: Renewal): Promise<void> => {
  await bridge.putEvents({
    Entries: [
      {
        EventBusName: 'library-events',
        Source: 'library.loans',
        DetailType: 'LoanRenewed',
        Detail: JSON.stringify(renewal),
      },
    ],
  });
};

/**
 * A bus named by the deployment. The code says which variable holds it and
 * nothing more, so the publisher has no channel until the deployment is read.
 */
export const auditLoan = async (loan: Loan): Promise<void> => {
  await events.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: process.env.AUDIT_BUS_NAME,
          Source: 'library.loans',
          DetailType: 'LoanAudited',
          Detail: JSON.stringify({ loanId: loan.loanId }),
        },
      ],
    }),
  );
};
