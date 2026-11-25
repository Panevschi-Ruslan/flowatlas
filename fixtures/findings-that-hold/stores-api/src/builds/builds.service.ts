import { Injectable } from '@nestjs/common';
import { BuildBus } from './build-bus';

/** Publishes the progress of the store's site builds on `build_updates`, told apart by `type`. */
@Injectable()
export class BuildsService {
  constructor(private readonly bus: BuildBus) {}

  async queued(jobId: string): Promise<void> {
    await this.bus.publish('build_updates', { type: 'JOB_QUEUED', jobId });
  }

  async done(jobId: string, artifactName: string): Promise<void> {
    await this.bus.publish('build_updates', { type: 'BUILD_DONE', jobId, artifactName });
  }

  async status(jobId: string, status: string): Promise<void> {
    await this.bus.publish('build_updates', { type: 'BUILD_STATUS', jobId, status });
  }

  async failed(jobId: string, reason: string): Promise<void> {
    await this.bus.publish('build_updates', { type: 'BUILD_FAILED', jobId, reason });
  }
}
