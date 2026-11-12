import type { CreateJob } from './job-queue.js';

export function buildPublishJob(itemId: string): CreateJob {
  return { type: 'publish-item', payload: { itemId } };
}

/** The jobs telling staff, as a list of its own. */
export function buildNotifyJobs(itemId: string): CreateJob[] {
  return [{ type: 'notify-staff', payload: { itemId } }];
}

export async function buildRetryJob(importId: string) {
  return { type: 'retry-import' as const, payload: { importId } };
}
