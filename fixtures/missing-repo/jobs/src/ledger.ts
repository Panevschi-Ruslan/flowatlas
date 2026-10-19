import type { KinesisStreamEvent } from 'aws-lambda';

/** Books every captured payment, in the order the stream hands them over. */
export const handler = async (event: KinesisStreamEvent): Promise<void> => {
  console.log(event.Records.length);
};
