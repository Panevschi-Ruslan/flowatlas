import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

/**
 * `@Processor()` with no queue name at all. There is nothing to use as the
 * channel, so this is the "never crash on a decorator with no args" row (§10):
 * the pass writes `unresolved: channel-dynamic` and carries on.
 */
@Processor()
export class AnonymousProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    void job.name;
  }
}
