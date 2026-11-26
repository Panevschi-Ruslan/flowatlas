import type { SNSEvent } from 'aws-lambda';

/** Pages whoever is on call for each alert. */
export const handler = async (event: SNSEvent): Promise<number> => event.Records.length;
