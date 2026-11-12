import { Inject, Injectable } from '@nestjs/common';

import { JobQueueService } from '../queue/job-queue.service';

/**
 * A queue's service under a token nothing in the shop provides: the queue is
 * whatever the instance was built with, and nothing says what that is. The
 * enqueue is drawn here, with no channel and a row naming the instance.
 */
@Injectable()
export class AuditService {
  constructor(@Inject('AUDIT_QUEUE') private readonly auditQueue: JobQueueService) {}

  record(action: string): Promise<void> {
    return this.auditQueue.add('audit', { action });
  }
}
