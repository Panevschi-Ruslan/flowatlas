import { Processor, Queue, Worker } from 'bullmq';

/**
 * One client per queue service: the queue and the worker are made when the
 * service opens them, from the topic the service hands in, the class chosen
 * by whether the paid edition is switched on.
 */
export class BullService {
  static readonly premium: boolean = process.env.PREMIUM_QUEUES !== undefined;

  private queueClient: Queue;
  private worker: Worker;

  openQueue(topic: string): void {
    const QueueClass = !BullService.premium ? Queue : require('bullmq-premium').QueuePremium;
    this.queueClient = new QueueClass(topic, { connection: {} });
  }

  openWorker(topic: string, processor: Processor): void {
    const WorkerClass = !BullService.premium ? Worker : require('bullmq-premium').WorkerPremium;
    this.worker = new WorkerClass(topic, processor, { connection: {} });
  }

  async add(name: string, data: unknown): Promise<void> {
    await this.queueClient.add(name, data);
  }
}
