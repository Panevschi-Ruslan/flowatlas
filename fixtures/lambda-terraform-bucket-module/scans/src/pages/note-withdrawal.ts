import type { SNSEvent } from 'aws-lambda';

/** Told of every delete marker a withdrawal leaves: notes the page as withdrawn. */
export const handler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) console.log(`withdrawn: ${record.Sns.Message}`);
};
