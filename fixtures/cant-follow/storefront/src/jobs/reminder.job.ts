import { Injectable } from '@nestjs/common';
import { Queue } from '@shopkit/queue';

@Injectable()
export class ReminderJob {
  constructor(private readonly queue: Queue) {}

  private legacy: any;

  start(registry: { on(event: string, handler: Function): void }): void {
    registry.on('remind', (job) => job.ack());
    this.legacy.flush();
  }

  handle(payload) {
    payload.complete();
  }
}
