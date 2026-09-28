import { Injectable } from '@nestjs/common';

import { JobBus } from '../jobs/job-bus.service';
import { DigestQueue, MailQueue, TenantQueue } from '../jobs/queues';

/**
 * Publishing, in both shapes.
 *
 * Every call here is a publish and not one of them names its channel at an
 * argument index.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly jobs: JobBus,
    private readonly mail: MailQueue,
    private readonly digest: DigestQueue,
    private readonly tenant: TenantQueue,
  ) {}

  /** The name is a property of argument 0: `channel:thumbnail.generate`. */
  place(orderId: string): void {
    this.jobs.queue({ name: 'thumbnail.generate', data: { orderId } });
  }

  /**
   * The same shape written short, and the same channel as the class-per-queue
   * call below: one channel node, two ways of addressing it.
   */
  confirm(orderId: string): void {
    this.jobs.queue({ name: 'mail.send', data: { orderId } });
  }

  /** A property written as shorthand reads exactly as one written out. */
  reindex(): void {
    const name = 'index.rebuild' as const;
    this.jobs.queue({ name, data: {} });
  }

  /** The receiver is the channel: `channel:mail.send`. */
  notify(to: string): void {
    this.mail.push({ to, subject: 'Your order' });
  }

  /** A second class, a second channel: `channel:digest.send`. */
  digestFor(userId: string): void {
    this.digest.push({ userId });
  }

  /** The control: no readable name anywhere, so no channel and a row. */
  perTenant(userId: string): void {
    this.tenant.push({ userId });
  }
}
