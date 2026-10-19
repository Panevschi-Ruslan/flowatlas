import type { CloudWatchLogsEvent } from 'aws-lambda';

/** Counts the log lines it is handed. */
export const handler = async (event: CloudWatchLogsEvent): Promise<void> => {
  console.log(event.awslogs.data.length);
};
