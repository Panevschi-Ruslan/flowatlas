import { Job, Queue, Worker } from 'bullmq';
import { makeThumbnail, refreshCatalog, sendReceipt } from './handlers.js';

export type JobType = 'send-receipt' | 'make-thumbnail' | 'refresh-catalog';

export type CreateJob =
  | { type: 'send-receipt'; payload: { orderId: string; email: string } }
  | { type: 'make-thumbnail'; payload: { imageUrl: string } }
  | { type: 'refresh-catalog'; payload: { storeId: string } };

/** One handler per kind of job; each kind is a queue of its own. */
const handlers: { [type in JobType]: (job: Job) => Promise<void> } = {
  'send-receipt': sendReceipt,
  'make-thumbnail': makeThumbnail,
  'refresh-catalog': refreshCatalog,
};

const failureHandlers: { [type in JobType]?: (job: Job, err: Error) => Promise<void> } = {};

class JobQueue {
  private workers: { [type in JobType]?: Worker } = {};
  private queues: { [type in JobType]?: Queue } = {};

  init(): void {
    for (const type of Object.keys(handlers)) {
      this.buildWorker(type as JobType);
      this.buildQueue(type as JobType);
    }
  }

  private buildWorker(type: JobType): void {
    const handler = (job: Job) => handlers[type](job);
    const processor = (job: Job) => withTiming(handler, job);
    const worker = new Worker(type, processor, { concurrency: 2 });
    worker.on('failed', (job: Job, err: Error) => failureHandlers[type]?.(job, err));
    this.workers[type] = worker;
  }

  private buildQueue(type: JobType): void {
    this.queues[type] = new Queue(type);
  }

  createJob(options: CreateJob) {
    const queue: Queue = this.queues[options.type];
    return queue.add('job', options.payload);
  }
}

const withTiming = async (run: (job: Job) => Promise<void>, job: Job): Promise<void> => {
  const started = Date.now();
  await run(job);
  console.log('took', Date.now() - started);
};

export const jobQueue = new JobQueue();
