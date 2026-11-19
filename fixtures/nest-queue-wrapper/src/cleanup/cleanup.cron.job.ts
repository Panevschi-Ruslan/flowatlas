import { Process, Processor } from '../queue/processor.decorator';
import { QueueName } from '../queue/queue-name';

/**
 * The options object with nothing in it but the queue: read whole, this was
 * the channel `{"queueName":"cron-queue"}` (R181).
 */
@Processor({ queueName: QueueName.cron })
export class CleanupCronJob {
  @Process(CleanupCronJob.name)
  async handle(): Promise<void> {
    return;
  }
}

/** The same queue written as a word, which has to land on the same channel. */
@Processor(QueueName.cron)
export class ReportCronJob {
  @Process(ReportCronJob.name)
  async handle(): Promise<void> {
    return;
  }
}
