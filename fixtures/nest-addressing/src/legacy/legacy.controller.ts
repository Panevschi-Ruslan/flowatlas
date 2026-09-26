import { Controller, Get, Post, Version } from '@nestjs/common';

/**
 * A controller that names no version, and one handler that names two.
 *
 * `list` inherits the application's default version, which is the commonest case
 * of all and the one that was silently wrong: it answers on `/api/v1/legacy`,
 * and nothing in this file says `1`. `replay` is served twice, once per version
 * it names, which is two addresses and therefore two entries.
 */
@Controller('legacy')
export class LegacyController {
  @Get()
  list(): string[] {
    return [];
  }

  @Version(['1', '2'])
  @Post('replay')
  replay(): string {
    return 'queued';
  }
}
