import { Body, Controller, Post } from '@nestjs/common';

import { BuildBot } from './build-bot';
import type { BuildDoneEvent, BuildMessage, BuildRetriedEvent, BuildStatusEvent, JobQueuedEvent } from './build-events';

/** What a worker posts: every message of the build channel, dispatched by its type with an if, an else if and an else. */
@Controller('events')
export class BuildRelayController {
  constructor(private readonly bot: BuildBot) {}

  @Post('builds')
  relay(@Body() body: { message: BuildMessage }): string {
    const event = body.message;
    const { type } = event;
    if (type === 'JOB_QUEUED') {
      return this.bot.handleJobQueued(event as JobQueuedEvent);
    } else if (type === 'BUILD_DONE') {
      return this.bot.handleBuildDone(event as unknown as BuildDoneEvent);
    } else if (type === 'BUILD_FAILED') {
      return this.bot.handleBuildRetry(event as unknown as BuildRetriedEvent);
    } else {
      return this.bot.handleBuildStatus(event as BuildStatusEvent);
    }
  }
}
