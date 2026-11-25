import { Injectable } from '@nestjs/common';
import { Consumes } from '@flowatlas/markers';

import type { BuildDoneEvent, BuildRetriedEvent, BuildStatusEvent, JobQueuedEvent } from './build-events';

/**
 * The back office's handlers of the build channel, each marked as a consumer
 * of it. None reads the type: its parameter's type says it, and so does the
 * branch of the relay that calls it.
 */
@Injectable()
export class BuildBot {
  @Consumes('build_updates')
  handleJobQueued(event: JobQueuedEvent): string {
    return `queued ${event.jobId} at ${event.priority}`;
  }

  /** Its parameter says BUILD_RETRIED; the relay calls it in the branch for BUILD_FAILED. */
  @Consumes('build_updates')
  handleBuildRetry(event: BuildRetriedEvent): string {
    return `attempt ${event.attempt}`;
  }

  /** Its parameter says BUILD_DONE, and the relay calls it in the branch for BUILD_DONE. */
  @Consumes('build_updates')
  handleBuildDone(event: BuildDoneEvent): string {
    return `built ${event.artifactName}`;
  }

  /** Its parameter says BUILD_STATUS, and the relay calls it in the last `else`: every other type. */
  @Consumes('build_updates')
  handleBuildStatus(event: BuildStatusEvent): string {
    return this.applyStatus(event);
  }

  private applyStatus(event: BuildStatusEvent): string {
    return `status ${event.status}`;
  }
}
