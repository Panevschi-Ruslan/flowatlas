import { Scope } from '@nestjs/common';

import { Process, Processor } from '../queue/processor.decorator';
import { QueueName } from '../queue/queue-name';

export interface BuildExportData {
  exportId: string;
  format: 'csv' | 'json';
}

/** A worker built per request, so its queue is named in the options object. */
@Processor({ queueName: QueueName.exports, scope: Scope.REQUEST })
export class BuildExportJob {
  @Process(BuildExportJob.name)
  async handle(data: BuildExportData): Promise<void> {
    void data.exportId;
  }
}
