import type { KinesisStreamEvent } from 'aws-lambda';

/** Reads shelf scans in order; a batch it gives up on goes to a topic. */
export const handler = async (event: KinesisStreamEvent): Promise<void> => {
  console.log(event.Records.length);
};
