import { Controller, Get } from '@nestjs/common';

/**
 * A route no application can be shown to serve.
 *
 * Its module declares it through a spread, so nothing here can say which
 * application mounts it, and its id carries no application — which is the honest
 * answer and not a good one: were a second application to serve `/legacy` too,
 * the two would collide again exactly as before. The row on the module's
 * controller list is what says so.
 */
@Controller('legacy')
export class LegacyController {
  @Get()
  list(): string {
    return 'legacy';
  }
}
