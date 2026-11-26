import { Processor, Queue, Worker } from 'bullmq';

export interface QueuedJob {
  name: string;
  data: unknown;
}

/**
 * One client per queue service and per worker service: the queue and the
 * worker are made when the service opens them, from the topic it hands in.
 */
export class BullClient {
  private queue: Queue;
  private worker: Worker;

  openQueue(topic: string): void {
    this.queue = new Queue(topic, { connection: {} });
  }

  openWorker(topic: string, processor: Processor): void {
    this.worker = new Worker(topic, processor, { connection: {} });
  }

  async add(name: string, data: unknown): Promise<void> {
    await this.queue.add(name, data);
  }

  async addBulk(jobs: QueuedJob[]): Promise<void> {
    await this.queue.addBulk(jobs.map((job) => ({ name: job.name, data: job.data })));
  }
}
