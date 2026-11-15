import { Job, Worker } from 'bullmq';

/** Receipts: the processor is written where the worker is made, and does more than hand the job on. */
export class ReceiptWorker {
  private readonly worker: Worker;

  constructor() {
    this.worker = new Worker(
      'receipts',
      async (job: Job<{ orderId: string; email: string }>) => {
        const body = await renderReceipt(job.data.orderId);
        await sendReceipt(job.data.email, body);
      },
      { connection: {} },
    );
  }
}

/** Refunds, started by a function: the processor written at the construction is its own handler too. */
export function startRefunds(): Worker {
  return new Worker(
    'refunds',
    async (job: Job<{ orderId: string }>) => {
      if (job.data.orderId === '') return;
      await refundOrder(job.data.orderId);
    },
    { connection: {} },
  );
}

export async function renderReceipt(orderId: string): Promise<string> {
  return `receipt for ${orderId}`;
}

export async function sendReceipt(email: string, body: string): Promise<void> {
  console.log('receipt to', email, body.length);
}

export async function refundOrder(orderId: string): Promise<void> {
  console.log('refund', orderId);
}
