import { Process, Processor } from '../queue/processor.decorator';
import { QueueName } from '../queue/queue-name';

export interface SendMailData {
  to: string;
  template: string;
}

/** The same decorator with the queue written as a word. */
@Processor(QueueName.mail)
export class SendMailJob {
  @Process(SendMailJob.name)
  async handle(data: SendMailData): Promise<void> {
    void data.to;
  }
}
