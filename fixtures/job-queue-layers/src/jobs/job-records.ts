import type { CreateJob } from './job-queue.js';

const audit = async (orderId: string): Promise<void> => {
  console.log('audit', orderId);
};

/** A job record built after some work of its own, its kind the caller's. */
export async function buildArchiveJob(options: { orderId: string; type: 'archive-order' | 'restore-order' }) {
  const { orderId, type } = options;
  await audit(orderId);
  return { type, payload: { orderId } };
}

/** A job built only when one is needed, of one kind or another. */
export async function buildThumbnailJobIfNeeded(options: { imageUrl: string; notify: boolean }) {
  if (options.imageUrl.endsWith('.png')) {
    return { type: 'make-thumbnail' as const, payload: { imageUrl: options.imageUrl } };
  }
  if (options.notify) return buildNotifyJob(options.imageUrl);
  return undefined;
}

export function buildNotifyJob(target: string): CreateJob {
  return { type: 'notify-staff', payload: { target } };
}
