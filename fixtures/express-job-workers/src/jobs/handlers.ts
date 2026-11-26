import { Job } from 'bullmq';

export type ReceiptPayload = { orderId: string; email: string };
export type ThumbnailPayload = { imageUrl: string };

export async function sendReceipt(job: Job<ReceiptPayload>): Promise<void> {
  console.log('receipt for', job.data.orderId);
}

export async function makeThumbnail(job: Job<ThumbnailPayload>): Promise<void> {
  console.log('thumbnail of', job.data.imageUrl);
}

export const refreshCatalog = async (job: Job<{ storeId: string }>): Promise<void> => {
  console.log('catalog of', job.data.storeId);
};
