import { Process, Processor } from '../queue/processor.decorator';

/**
 * Options under a key no description reads. A queue is never named by a
 * record, so this is a worker whose queue cannot be read - not a channel
 * called `{"queue":"audit-queue"}` (R181).
 */
@Processor({ queue: 'audit-queue' } as never)
export class AuditJob {
  @Process('audit')
  async handle(): Promise<void> {
    return;
  }
}
