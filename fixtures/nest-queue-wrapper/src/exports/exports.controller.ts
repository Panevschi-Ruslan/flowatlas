import { Body, Controller, Post } from '@nestjs/common';

import { InjectJobQueue } from '../queue/inject-job-queue.decorator';
import { JobQueueService } from '../queue/job-queue.service';
import { QueueName } from '../queue/queue-name';
import { BuildExportJob, type BuildExportData } from './build-export.job';

@Controller('exports')
export class ExportsController {
  constructor(@InjectJobQueue(QueueName.exports) private readonly exportsQueue: JobQueueService) {}

  /** The job named after the class that handles it, on the queue the decorator asked for. */
  @Post()
  async start(@Body() body: { exportId: string }): Promise<void> {
    await this.exportsQueue.add<BuildExportData>(BuildExportJob.name, { exportId: body.exportId, format: 'csv' });
  }
}
