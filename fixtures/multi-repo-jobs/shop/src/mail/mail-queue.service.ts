import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export type MailData = { to: string; template: string };

/**
 * The shop's own layer over its mail queue: the queue is read here, and the
 * job is whatever each caller names.
 */
@Injectable()
export class MailQueueService {
  constructor(
    @InjectQueue('mail-queue') private readonly queue: Queue,
    @InjectQueue('image-queue') private readonly images: Queue,
  ) {}

  send(job: string, data: MailData) {
    return this.queue.add(job, data);
  }

  sendMany(job: string, list: MailData[]) {
    return this.queue.addBulk(list.map((data) => ({ name: job, data })));
  }

  sendPair(first: MailData, second: MailData) {
    return this.queue.addBulk([
      { name: 'send-welcome', data: first },
      { name: 'send-digest', data: second },
    ]);
  }

  resize(url: string) {
    return this.images.add('resize', { url });
  }
}
