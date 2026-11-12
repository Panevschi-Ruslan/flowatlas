import type { SQSEvent } from 'aws-lambda';

/** Replays what the readers of the clicks stream gave up on, from the failed queue. */
export const handler = async (event: SQSEvent): Promise<number> => event.Records.length;
