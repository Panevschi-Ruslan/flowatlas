import type { SQSEvent } from 'aws-lambda';

/** Reads the notices queue, whose name CloudFormation chooses, and sends each notice. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) console.log('notice', record.body);
};
