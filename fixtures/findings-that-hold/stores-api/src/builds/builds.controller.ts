import { Controller, Param, Post } from '@nestjs/common';
import { BuildsService } from './builds.service';

@Controller('builds/:jobId')
export class BuildsController {
  constructor(private readonly builds: BuildsService) {}

  @Post('queued')
  queued(@Param('jobId') jobId: string): Promise<void> {
    return this.builds.queued(jobId);
  }

  @Post('done/:artifact')
  done(@Param('jobId') jobId: string, @Param('artifact') artifact: string): Promise<void> {
    return this.builds.done(jobId, artifact);
  }

  @Post('failed/:reason')
  failed(@Param('jobId') jobId: string, @Param('reason') reason: string): Promise<void> {
    return this.builds.failed(jobId, reason);
  }

  @Post('status/:status')
  status(@Param('jobId') jobId: string, @Param('status') status: string): Promise<void> {
    return this.builds.status(jobId, status);
  }
}
