import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

/**
 * A function deployed on its own, with its own manifest: nothing at the root of
 * the repository declares the SNS client, and the reader is switched on by the
 * manifest beside this file.
 */
const sns = new SNSClient({ region: 'eu-west-1' });

const BORROWER_NOTIFICATIONS = 'arn:aws:sns:eu-west-1:111122223333:borrower-notifications';

export interface LoanDue {
  loanId: string;
  borrowerId: string;
  dueOn: string;
}

export const handler = async (event: LoanDue): Promise<void> => {
  await sns.send(
    new PublishCommand({
      TopicArn: BORROWER_NOTIFICATIONS,
      Subject: 'A loan is due',
      Message: JSON.stringify({ borrowerId: event.borrowerId, dueOn: event.dueOn }),
    }),
  );
  // Escalations go to a topic the deployment names.
  await sns.send(new PublishCommand({ TopicArn: process.env.ESCALATIONS_TOPIC_ARN, Message: JSON.stringify(event) }));
};
