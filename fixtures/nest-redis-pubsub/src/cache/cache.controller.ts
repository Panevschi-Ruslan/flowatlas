import { Body, Controller, Post } from '@nestjs/common';

import type { CacheInvalidated } from './cache-events';
import { CachePublisherService } from './cache-publisher.service';

/** An http entry so the publishers are reachable from a P01 entry node. */
@Controller('cache')
export class CacheController {
  constructor(private readonly publisher: CachePublisherService) {}

  @Post('invalidate')
  async invalidate(@Body() body: CacheInvalidated): Promise<{ published: number }> {
    return { published: await this.publisher.invalidate(body) };
  }
}
