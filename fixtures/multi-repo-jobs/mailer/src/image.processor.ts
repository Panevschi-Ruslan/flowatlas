import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

/** A worker that takes every job of its queue, whatever it is named. */
@Processor('image-queue')
export class ImageProcessor extends WorkerHost {
  async process(job: Job<{ url: string }>): Promise<void> {
    void job.data.url;
  }
}
