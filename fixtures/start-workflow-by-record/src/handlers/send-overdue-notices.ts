import { Job, jobs } from '@library/jobs';

/** Runs every morning: queues the overdue notices as one job. */
export const handler = async (): Promise<void> => {
  // The same shape through another shared package, not installed and not described.
  const job = await jobs.prepare({ kind: Job.OverdueNotices, dueBefore: new Date().toISOString() });
  await jobs.submit({ jobId: job.id });
};
