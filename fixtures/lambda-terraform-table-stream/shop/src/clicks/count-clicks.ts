import type { KinesisStreamEvent } from 'aws-lambda';

const counts = new Map<string, number>();

/** Run by the clicks stream: counts the clicks on each page. */
export const handler = async (event: KinesisStreamEvent): Promise<void> => {
  for (const record of event.Records) {
    const click = JSON.parse(atob(record.kinesis.data)) as { page: string };
    counts.set(click.page, (counts.get(click.page) ?? 0) + 1);
  }
};
